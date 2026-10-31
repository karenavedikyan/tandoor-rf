import { TELEGRAM_API_ORIGIN } from "../../tanbot-telegram/config";
import { readBoundedResponseBody } from "../../tanbot-telegram/bounded-body";
import { loadTanbotTelegramStage2Config } from "../../tanbot-telegram/stage2-config";
import { MAX_API_ORIGIN } from "../../tanbot-max/config";
import { loadTanbotMaxStage2Config } from "../../tanbot-max/stage2-config";
import { createDefaultMaxTransport } from "../../tanbot-max/transport";
import {
  mergeManagedBotCommands,
  type CommandInstallPlan,
  type CommandInstallResult,
  type CommandInstallTransport,
  type ManagedMessengerBotCommand,
} from "./bot-command-registry";

const INSTALL_TIMEOUT_MS = 15_000;
const TELEGRAM_COMMAND_LIMIT = 100;
const MAX_COMMAND_LIMIT = 32;

async function boundedJsonGet(
  url: string,
  headers: Record<string, string>,
): Promise<
  | { ok: true; json: unknown }
  | { ok: false; code: "network" | "redirect" | "timeout" | "provider_error"; message: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INSTALL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", headers, redirect: "error", signal: controller.signal });
    const body = await readBoundedResponseBody(res, 32_768);
    if (!body.ok) return { ok: false, code: "network", message: "Response too large." };
    if (!res.ok) return { ok: false, code: "provider_error", message: `HTTP ${res.status}` };
    return { ok: true, json: JSON.parse(body.text) as unknown };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "timeout", message: "Request timed out." };
    }
    return { ok: false, code: "network", message: "Network error." };
  } finally {
    clearTimeout(timer);
  }
}

function telegramCommandsFromApi(json: unknown): ManagedMessengerBotCommand[] {
  if (!json || typeof json !== "object" || !("ok" in json) || !(json as { ok?: boolean }).ok) return [];
  const result = (json as { result?: unknown }).result;
  if (!Array.isArray(result)) return [];
  const out: ManagedMessengerBotCommand[] = [];
  for (const row of result) {
    if (!row || typeof row !== "object") continue;
    const command = (row as { command?: string }).command;
    const description = (row as { description?: string }).description;
    if (typeof command === "string" && typeof description === "string") {
      out.push({ command: command.replace(/^\//, ""), description });
    }
  }
  return out;
}

export function createTelegramCommandInstallTransport(
  fetchImpl: typeof fetch = fetch,
): CommandInstallTransport {
  return async (plan) => {
    const loaded = loadTanbotTelegramStage2Config();
    if (!loaded.ok || !loaded.config.botToken) {
      return { ok: false, code: "provider_error", message: "Telegram is not configured." };
    }
    const token = loaded.config.botToken;
    const getUrl = `${TELEGRAM_API_ORIGIN}/bot${token}/getMyCommands`;
    const existingRes = await boundedJsonGet(getUrl, { Accept: "application/json" });
    if (!existingRes.ok) return existingRes;
    const merged = mergeManagedBotCommands(telegramCommandsFromApi(existingRes.json), plan.commands);
    if (merged.length > TELEGRAM_COMMAND_LIMIT) {
      return { ok: false, code: "provider_error", message: "Command list exceeds Telegram limit." };
    }
    const menuState = await boundedJsonGet(`${TELEGRAM_API_ORIGIN}/bot${token}/getChatMenuButton`, {
      Accept: "application/json",
    });
    let preserveWebApp = false;
    if (menuState.ok) {
      const result = (menuState.json as { result?: { type?: string } }).result;
      preserveWebApp = result?.type === "web_app";
    }
    const setBody = {
      commands: merged.map((c) => ({ command: c.command, description: c.description })),
      scope: { type: "default" },
    };
    const setRes = await fetchImpl(`${TELEGRAM_API_ORIGIN}/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(setBody),
      redirect: "error",
      signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
    });
    const setParsed = await readBoundedResponseBody(setRes, 32_768);
    if (!setRes.ok || !setParsed.ok) {
      return { ok: false, code: "provider_error", message: "setMyCommands failed." };
    }
    if (!preserveWebApp) {
      await fetchImpl(`${TELEGRAM_API_ORIGIN}/bot${token}/setChatMenuButton`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ menu_button: { type: "commands" } }),
        redirect: "error",
        signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
      });
    }
    return { ok: true, dryRun: false, mergedCount: merged.length };
  };
}

export function createMaxCommandInstallTransport(
  fetchImpl: typeof fetch = fetch,
): CommandInstallTransport {
  return async (plan) => {
    const loaded = loadTanbotMaxStage2Config();
    if (!loaded.ok || !loaded.config.botToken) {
      return { ok: false, code: "provider_error", message: "MAX is not configured." };
    }
    const transport = createDefaultMaxTransport(fetchImpl);
    const me = await transport({
      method: "me",
      token: loaded.config.botToken,
      timeoutMs: INSTALL_TIMEOUT_MS,
      maxResponseBytes: 32_768,
    });
    if (!me.ok) {
      return { ok: false, code: "provider_error", message: "MAX /me failed." };
    }
    const existingRaw = (me.result as { commands?: Array<{ name?: string; description?: string }> }).commands ?? [];
    const existing: ManagedMessengerBotCommand[] = existingRaw
      .filter((c) => typeof c.name === "string" && typeof c.description === "string")
      .map((c) => ({ command: c.name!.replace(/^\//, ""), description: c.description! }));
    const merged = mergeManagedBotCommands(existing, plan.commands);
    if (merged.length > MAX_COMMAND_LIMIT) {
      return { ok: false, code: "provider_error", message: "Command list exceeds MAX limit." };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INSTALL_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${MAX_API_ORIGIN}/me/commands`, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: loaded.config.botToken,
        },
        body: JSON.stringify({
          commands: merged.map((c) => ({ name: c.command, description: c.description })),
        }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, code: "provider_error", message: `MAX PATCH failed (${res.status}).` };
      return { ok: true, dryRun: false, mergedCount: merged.length };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, code: "timeout", message: "Request timed out." };
      }
      return { ok: false, code: "network", message: "Network error." };
    } finally {
      clearTimeout(timer);
    }
  };
}
