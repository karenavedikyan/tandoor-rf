import type { MaxInlineButton } from "../../tanbot-max/delivery-transport";

const OPEN_LINE_PREFIX = "Открыть: ";

export type MaxExternalPersonOutboxPresentation =
  | {
      mode: "rich";
      text: string;
      shareUrl: string;
      inlineButtons: MaxInlineButton[][];
    }
  | { mode: "plain"; text: string };

function normalizeOrigin(appOrigin: string): string | null {
  const raw = appOrigin.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function isAllowedTrackerHolderUrl(url: URL, expectedOrigin: string): boolean {
  if (url.origin !== expectedOrigin) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return path === "/tan-tracker";
}

/** Strip trailing holder link line for MAX rich UI; never mutate arbitrary user/item URLs. */
export function buildMaxExternalPersonOutboxPresentation(
  storedBody: string,
  appOrigin: string,
): MaxExternalPersonOutboxPresentation {
  const body = storedBody.replace(/\r\n/g, "\n");
  const expectedOrigin = normalizeOrigin(appOrigin);
  if (!expectedOrigin) {
    return { mode: "plain", text: body };
  }

  const lines = body.split("\n");
  let lastNonEmpty = lines.length - 1;
  while (lastNonEmpty >= 0 && lines[lastNonEmpty]!.trim() === "") lastNonEmpty -= 1;
  if (lastNonEmpty < 0) {
    return { mode: "plain", text: body };
  }

  const lastLine = lines[lastNonEmpty]!;
  if (!lastLine.startsWith(OPEN_LINE_PREFIX)) {
    return { mode: "plain", text: body };
  }

  let openLineCount = 0;
  for (const line of lines) {
    if (line.startsWith(OPEN_LINE_PREFIX)) openLineCount += 1;
  }
  if (openLineCount !== 1) {
    return { mode: "plain", text: body };
  }

  const urlRaw = lastLine.slice(OPEN_LINE_PREFIX.length).trim();
  if (!urlRaw || /\s/.test(urlRaw)) {
    return { mode: "plain", text: body };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlRaw);
  } catch {
    return { mode: "plain", text: body };
  }

  if (!isAllowedTrackerHolderUrl(parsed, expectedOrigin)) {
    return { mode: "plain", text: body };
  }

  const displayLines = lines.slice(0, lastNonEmpty);
  while (displayLines.length > 0 && displayLines[displayLines.length - 1]!.trim() === "") {
    displayLines.pop();
  }
  const text = displayLines.join("\n");
  const holderUrl = parsed.toString();

  return {
    mode: "rich",
    text,
    shareUrl: holderUrl,
    inlineButtons: [[{ type: "link", text: "Открыть передачу", url: holderUrl }]],
  };
}
