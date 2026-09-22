import type { Request } from "express";
import { isTrustProxyEnabled } from "../config";

export function getClientIp(req: Request): string | null {
  if (isTrustProxyEnabled()) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) {
        return first;
      }
    }
  }

  const remote = req.socket.remoteAddress?.trim();
  return remote || null;
}
