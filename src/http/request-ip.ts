import type { Request } from "express";
import { getTrustedProxyEntries, resolveClientIp } from "./trusted-proxy";

function resolveSocketRemoteAddress(req: Request): string | undefined {
  const remote = req.socket.remoteAddress?.trim();
  if (remote) {
    return remote;
  }

  // supertest requests may not populate remoteAddress; keep deterministic local IP in tests.
  if (process.env.NODE_ENV === "test") {
    return "127.0.0.1";
  }

  return undefined;
}

export function getClientIp(req: Request): string | null {
  return resolveClientIp({
    socketRemoteAddress: resolveSocketRemoteAddress(req),
    xForwardedFor: req.headers["x-forwarded-for"],
    trustedProxies: getTrustedProxyEntries(),
  });
}
