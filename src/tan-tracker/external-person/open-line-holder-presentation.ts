const OPEN_LINE_PREFIX = "Открыть: ";

export type ParsedOpenLineHolderPresentation =
  | {
      mode: "rich";
      text: string;
      holderUrl: string;
    }
  | { mode: "plain"; text: string };

export function normalizeAppOrigin(appOrigin: string): string | null {
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

/** Strip trailing holder link line for rich messenger UI; never mutate arbitrary user/item URLs. */
export function parseOpenLineHolderPresentation(
  storedBody: string,
  appOrigin: string,
): ParsedOpenLineHolderPresentation {
  const body = storedBody.replace(/\r\n/g, "\n");
  const expectedOrigin = normalizeAppOrigin(appOrigin);
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
    holderUrl,
  };
}

/** Public OG page for Telegram link preview (no query/hash/capability tokens). */
export function publicTanTrackerBrandPreviewUrl(appOrigin: string): string | null {
  const origin = normalizeAppOrigin(appOrigin);
  if (!origin) return null;
  return `${origin}/tan-tracker/`;
}
