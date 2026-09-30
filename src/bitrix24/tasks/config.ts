export type Bitrix24TasksRuntimeConfig = {
  cachePublishEnabled: boolean;
  cacheAccessTtlMs: number;
  pilotTaskIds: Set<string>;
  pilotAllowListRequired: boolean;
  portalPublicUrl: string | null;
};

export function isCachePublishAllowed(config: Bitrix24TasksRuntimeConfig): boolean {
  return config.cachePublishEnabled && config.cacheAccessTtlMs > 0;
}

export function loadBitrix24TasksRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): Bitrix24TasksRuntimeConfig {
  const publishRaw = env.BITRIX24_CACHE_PUBLISH_ENABLED?.trim().toLowerCase();
  const cachePublishEnabled = publishRaw === "true" || publishRaw === "1";
  const ttlRaw = Number(env.BITRIX24_CACHE_ACCESS_TTL_MS?.trim() || "0");
  const cacheAccessTtlMs =
    Number.isInteger(ttlRaw) && ttlRaw > 0 ? ttlRaw : 0;
  const pilotTaskIds = new Set(
    (env.BITRIX24_PILOT_TASK_IDS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  const portalPublicUrl = env.BITRIX24_PORTAL_PUBLIC_URL?.trim() || null;
  const pilotRequiredRaw = env.BITRIX24_PILOT_ALLOWLIST_REQUIRED?.trim().toLowerCase();
  const pilotAllowListRequired =
    pilotRequiredRaw === undefined || pilotRequiredRaw === ""
      ? true
      : pilotRequiredRaw === "true" || pilotRequiredRaw === "1";
  return {
    cachePublishEnabled,
    cacheAccessTtlMs,
    pilotTaskIds,
    pilotAllowListRequired,
    portalPublicUrl,
  };
}
