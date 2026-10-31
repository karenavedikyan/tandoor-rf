import { TELEGRAM_API_ORIGIN } from "../../tanbot-telegram/config";
import { readBoundedResponseBody } from "../../tanbot-telegram/bounded-body";
import { loadTanbotTelegramStage2Config } from "../../tanbot-telegram/stage2-config";
import { MAX_API_ORIGIN } from "../../tanbot-max/config";
import { loadTanbotMaxStage2Config } from "../../tanbot-max/stage2-config";
import { createDefaultMaxTransport } from "../../tanbot-max/transport";
import {
  createMaxDispatcher,
  readMaxTlsCaBundle,
  wrapFetchWithMaxTls,
} from "../../tanbot-max/tls-fetch";
import {
  mergeManagedBotCommands,
  type CommandInstallPlan,
  type CommandInstallResult,
  type CommandInstallTransport,
  type ManagedMessengerBotCommand,
} from "./bot-command-registry";

const INSTALL_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 32_768;
const TELEGRAM_COMMAND_LIMIT = 100;
const MAX_COMMAND_LIMIT = 32;

type SafeHttpFailure = {
  ok: false;
  code: "network" | "redirect" | "timeout" | "provider_error";
  message: string;
};

type SafeHttpJson = { ok: true; json: unknown; status: number };

async function boundedHttpsJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<SafeHttpJson | SafeHttpFailure> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INSTALL_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    const body = await readBoundedResponseBody(res, MAX_RESPONSE_BYTES);
    if (!body.ok) {
      return { ok: false, code: "network", message: "Response too large." };
    }
    if (!res.ok) {
      return { ok: false, code: "provider_error", message: "Provider request failed." };
    }
    try {
      return { ok: true, json: JSON.parse(body.text) as unknown, status: res.status };
    } catch {
      return { ok: false, code: "provider_error", message: "Invalid provider response." };
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "timeout", message: "Request timed out." };
    }
    return { ok: false, code: "network", message: "Network error." };
  } finally {
    clearTimeout(timer);
  }
}

function parseTelegramCommandListResponse(
  json: unknown,
):
  | { ok: true; commands: ManagedMessengerBotCommand[] }
  | { ok: false; code: SafeHttpFailure["code"]; message: string } {
  if (!json || typeof json !== "object") {
    return { ok: false, code: "provider_error", message: "Invalid command list response." };
  }
  const envelope = json as { ok?: unknown; result?: unknown };
  if (envelope.ok !== true) {
    return { ok: false, code: "provider_error", message: "Existing commands could not be read." };
  }
  if (!Array.isArray(envelope.result)) {
    return { ok: false, code: "provider_error", message: "Invalid command list." };
  }
  const commands: ManagedMessengerBotCommand[] = [];
  for (const row of envelope.result) {
    if (!row || typeof row !== "object") {
      return { ok: false, code: "provider_error", message: "Invalid command row." };
    }
    const command = (row as { command?: unknown }).command;
    const description = (row as { description?: unknown }).description;
    if (typeof command !== "string" || typeof description !== "string") {
      return { ok: false, code: "provider_error", message: "Invalid command metadata." };
    }
    commands.push({ command: command.replace(/^\//, ""), description });
  }
  return { ok: true, commands };
}

type TelegramMenuKind = "web_app" | "commands_menu";

function parseTelegramMenuButtonResponse(
  json: unknown,
):
  | { ok: true; kind: TelegramMenuKind }
  | { ok: false; code: SafeHttpFailure["code"]; message: string } {
  if (!json || typeof json !== "object") {
    return { ok: false, code: "provider_error", message: "Invalid menu response." };
  }
  const envelope = json as { ok?: unknown; result?: unknown };
  if (envelope.ok !== true) {
    return { ok: false, code: "provider_error", message: "Menu state unavailable." };
  }
  const result = envelope.result;
  if (!result || typeof result !== "object") {
    return { ok: false, code: "provider_error", message: "Invalid menu state." };
  }
  const type = (result as { type?: unknown }).type;
  if (type === "web_app") return { ok: true, kind: "web_app" };
  if (type === "commands" || type === "default") return { ok: true, kind: "commands_menu" };
  return { ok: false, code: "provider_error", message: "Unexpected menu type." };
}

function parseTelegramMutationAck(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const envelope = json as { ok?: unknown; result?: unknown };
  return envelope.ok === true && envelope.result === true;
}

function parseMaxCommandsFromMe(
  meResult: unknown,
):
  | { ok: true; commands: ManagedMessengerBotCommand[] }
  | { ok: false; code: SafeHttpFailure["code"]; message: string } {
  if (!meResult || typeof meResult !== "object") {
    return { ok: false, code: "provider_error", message: "Invalid profile response." };
  }
  const commandsRaw = (meResult as { commands?: unknown }).commands;
  if (commandsRaw === null || commandsRaw === undefined) {
    return { ok: true, commands: [] };
  }
  if (!Array.isArray(commandsRaw)) {
    return { ok: false, code: "provider_error", message: "Invalid command list." };
  }
  const commands: ManagedMessengerBotCommand[] = [];
  for (const row of commandsRaw) {
    if (!row || typeof row !== "object") {
      return { ok: false, code: "provider_error", message: "Invalid command row." };
    }
    const name = (row as { name?: unknown }).name;
    const description = (row as { description?: unknown }).description;
    if (
      typeof name !== "string" || name.length < 1 || name.length > 64 ||
      (description !== undefined && description !== null &&
        (typeof description !== "string" || description.length < 1 || description.length > 128))
    ) {
      return { ok: false, code: "provider_error", message: "Invalid command metadata." };
    }
    commands.push({ command: name.replace(/^\//, ""), description });
  }
  return { ok: true, commands };
}

/**
 * MAX returns the saved command list, not a SimpleQueryResult.
 * https://dev.max.ru/docs-api/methods/PATCH/me/commands
 */
function parseMaxPatchAck(json: unknown, expected: ManagedMessengerBotCommand[]): boolean {
  if (!json || typeof json !== "object" || !Array.isArray((json as { commands?: unknown }).commands)) return false;
  const parsed = parseMaxCommandsFromMe(json);
  if (!parsed.ok || parsed.commands.length !== expected.length) return false;
  const actual = new Map(parsed.commands.map(c => [c.command, c]));
  return actual.size === expected.length && expected.every(c => {
    const saved = actual.get(c.command);
    return saved != null && (saved.description ?? null) === (c.description ?? null);
  });
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
    const getCommandsRes = await boundedHttpsJson(fetchImpl, `${TELEGRAM_API_ORIGIN}/bot${token}/getMyCommands`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!getCommandsRes.ok) return getCommandsRes;

    const existingParsed = parseTelegramCommandListResponse(getCommandsRes.json);
    if (!existingParsed.ok) {
      return { ok: false, code: existingParsed.code, message: existingParsed.message };
    }

    const menuRes = await boundedHttpsJson(fetchImpl, `${TELEGRAM_API_ORIGIN}/bot${token}/getChatMenuButton`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!menuRes.ok) return menuRes;

    const menuParsed = parseTelegramMenuButtonResponse(menuRes.json);
    if (!menuParsed.ok) {
      return { ok: false, code: menuParsed.code, message: menuParsed.message };
    }

    const merged = mergeManagedBotCommands(existingParsed.commands, plan.commands);
    if (merged.length > TELEGRAM_COMMAND_LIMIT) {
      return { ok: false, code: "provider_error", message: "Command list exceeds Telegram limit." };
    }

    const setBody = {
      commands: merged.map((c) => ({ command: c.command, description: c.description })),
      scope: { type: "default" },
    };
    const setCommandsRes = await boundedHttpsJson(fetchImpl, `${TELEGRAM_API_ORIGIN}/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(setBody),
    });
    if (!setCommandsRes.ok) return setCommandsRes;
    if (!parseTelegramMutationAck(setCommandsRes.json)) {
      return { ok: false, code: "provider_error", message: "setMyCommands was not acknowledged." };
    }

    if (menuParsed.kind === "web_app") {
      return { ok: true, dryRun: false, mergedCount: merged.length };
    }

    const setMenuRes = await boundedHttpsJson(fetchImpl, `${TELEGRAM_API_ORIGIN}/bot${token}/setChatMenuButton`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ menu_button: { type: "commands" } }),
    });
    if (!setMenuRes.ok) return setMenuRes;
    if (!parseTelegramMutationAck(setMenuRes.json)) {
      return {
        ok: false,
        code: "provider_error",
        message: "Commands were updated but menu button was not acknowledged.",
      };
    }

    return { ok: true, dryRun: false, mergedCount: merged.length };
  };
}

export function createMaxCommandInstallTransport(
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): CommandInstallTransport {
  return async (plan) => {
    const loaded = loadTanbotMaxStage2Config();
    if (!loaded.ok || !loaded.config.botToken) {
      return { ok: false, code: "provider_error", message: "MAX is not configured." };
    }
    const transport = createDefaultMaxTransport(fetchImpl, env);
    const me = await transport({
      method: "me",
      token: loaded.config.botToken,
      timeoutMs: INSTALL_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
    });
    if (!me.ok) {
      return { ok: false, code: "provider_error", message: "MAX /me failed." };
    }

    const existingParsed = parseMaxCommandsFromMe(me.result);
    if (!existingParsed.ok) {
      return { ok: false, code: existingParsed.code, message: existingParsed.message };
    }

    const merged = mergeManagedBotCommands(existingParsed.commands, plan.commands);
    if (merged.length > MAX_COMMAND_LIMIT) {
      return { ok: false, code: "provider_error", message: "Command list exceeds MAX limit." };
    }

    const ca = readMaxTlsCaBundle(env);
    const dispatcher = createMaxDispatcher(ca);
    const fetchWithTls = wrapFetchWithMaxTls(fetchImpl, dispatcher);

    const patchRes = await boundedHttpsJson(fetchWithTls, `${MAX_API_ORIGIN}/me/commands`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: loaded.config.botToken,
      },
      body: JSON.stringify({
        commands: merged.map((c) => ({ name: c.command, description: c.description })),
      }),
    });
    if (!patchRes.ok) return patchRes;
    if (!parseMaxPatchAck(patchRes.json, merged)) {
      return { ok: false, code: "provider_error", message: "MAX command update was not acknowledged." };
    }

    return { ok: true, dryRun: false, mergedCount: merged.length };
  };
}
