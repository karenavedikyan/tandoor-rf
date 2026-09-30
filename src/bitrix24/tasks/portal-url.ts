const BLOCKED_PUBLIC_PATH_FRAGMENTS = ["/rest/", "/webhook/", "/oauth/"];

function normalizeHttpsOrigin(hostOrUrl: string): URL | null {
  try {
    const candidate = hostOrUrl.includes("://") ? hostOrUrl : `https://${hostOrUrl}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isSafePublicPortalUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return !BLOCKED_PUBLIC_PATH_FRAGMENTS.some((fragment) => path.includes(fragment));
}

export function buildTaskPortalUrl(
  portalHost: string,
  portalPublicUrl: string | null,
  taskId: string,
): string | null {
  if (!portalPublicUrl) {
    return null;
  }
  const configured = normalizeHttpsOrigin(portalHost);
  const publicBase = normalizeHttpsOrigin(portalPublicUrl);
  if (!configured || !publicBase || !isSafePublicPortalUrl(publicBase)) {
    return null;
  }
  if (publicBase.origin !== configured.origin) {
    return null;
  }
  return `${publicBase.origin}/company/personal/tasks/task/view/${encodeURIComponent(taskId)}/`;
}
