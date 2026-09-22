import type { Response } from "express";

export function setNoStore(res: Response): void {
  res.set("Cache-Control", "no-store");
}
