import { getAppOrigin } from "../../config";
import { loadTanbotTelegramStage2Config } from "../../tanbot-telegram/stage2-config";
import { loadTanbotMaxStage2Config } from "../../tanbot-max/stage2-config";
import { buildTelegramDeepLink } from "../../tanbot-telegram/link-tokens";
import { isExternalMessengerFeatureEnabled } from "./config";

export type RecipientBotLinks = { telegram: string | null; max: string | null };
const TOKEN = /^er[A-Za-z0-9_-]{43}$/;
const LEGACY_ORIGIN = "https://lk.tandoor.ru";
const TECH_ORIGIN = "https://karenavedikyan-tandoor-rf-24e1.twc1.net";
const NAME = /^[A-Za-z0-9_]{1,128}$/;

export function recipientBotLinks(token: string, env: NodeJS.ProcessEnv = process.env): RecipientBotLinks {
  const links: RecipientBotLinks = { telegram: null, max: null };
  if (!TOKEN.test(token) || !isExternalMessengerFeatureEnabled(env)) return links;
  const telegram = loadTanbotTelegramStage2Config(env);
  const max = loadTanbotMaxStage2Config(env);
  if (telegram.ok && telegram.config.webhookEnabled && NAME.test(telegram.config.botUsername)) {
    links.telegram = buildTelegramDeepLink(telegram.config.botUsername, token);
  }
  if (max.ok && max.config.webhookEnabled) {
    const configured = env.TANBOT_MAX_BOT_PUBLIC_LINK?.trim();
    try {
      const name = max.config.botUsername;
      const url = new URL(configured || `https://max.ru/${name}`);
      if (url.protocol === "https:" && url.hostname === "max.ru" && !url.username && !url.password
        && !url.port && /^\/[A-Za-z0-9_]{1,128}\/?$/.test(url.pathname)) {
        url.search = ""; url.hash = "";
        url.searchParams.set("start", token);
        links.max = url.toString();
      }
    } catch { /* Do not publish malformed or foreign links. */ }
  }
  return links;
}

export type InvitationTextToken = { kind: "none" } | { kind: "invalid" } | { kind: "token"; token: string };

/** Extract only; never fetch pasted URLs or accept a public track number as authorization. */
export function invitationTokenFromText(text: string, env: NodeJS.ProcessEnv = process.env): InvitationTextToken {
  if (text.length > 4096) return { kind: "none" };
  const tokens = new Set<string>();
  let recognized = false, invalid = false;
  const appOrigin = env.APP_ORIGIN?.replace(/\/$/, "") || getAppOrigin();
  const origins = new Set([LEGACY_ORIGIN, TECH_ORIGIN, ...(appOrigin ? [appOrigin] : [])]);
  const expected = recipientBotLinks(`er${"x".repeat(43)}`, env);
  const botPaths = [expected.telegram, expected.max].filter((s): s is string => !!s)
    .map(s => { const url = new URL(s); return `${url.origin}${url.pathname.replace(/\/$/, "")}`; });
  for (const found of text.matchAll(/https?:\/\/[^\s<>"']+/giu)) {
    let url: URL;
    try { url = new URL(found[0].replace(/[),.;!?…\]]+$/u, "")); } catch { continue; }
    if (url.username || url.password || url.hash) continue;
    const web = origins.has(url.origin) && url.pathname.replace(/\/$/, "") === "/tan-tracker/recipient";
    const bot = botPaths.includes(`${url.origin}${url.pathname.replace(/\/$/, "")}`);
    if (!web && !bot) continue;
    recognized = true;
    const values = url.searchParams.getAll(web ? "mst" : "start");
    if (values.length !== 1 || !TOKEN.test(values[0])) { invalid = true; continue; }
    tokens.add(values[0]);
  }
  if (!recognized) return { kind: "none" };
  return invalid || tokens.size !== 1 ? { kind: "invalid" } : { kind: "token", token: [...tokens][0] };
}
