export function buildTaskPortalUrl(portalHost: string, portalPublicUrl: string | null, taskId: string): string | null {
  if (!portalPublicUrl) {
    return null;
  }
  try {
    const configured = new URL(`https://${portalHost}`);
    const publicBase = new URL(portalPublicUrl);
    if (publicBase.protocol !== "https:") {
      return null;
    }
    if (publicBase.hostname.toLowerCase() !== configured.hostname.toLowerCase()) {
      return null;
    }
    return `${publicBase.origin}/company/personal/tasks/task/view/${encodeURIComponent(taskId)}/`;
  } catch {
    return null;
  }
}
