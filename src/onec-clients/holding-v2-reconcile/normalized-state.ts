import { sha256Hex } from "../sha256";
import type { HoldingV2PersistedState } from "./types";

function normalizeFieldPresence(
  fp: Record<string, boolean> | undefined,
): Record<string, boolean> {
  return {
    guidCategory: fp?.guidCategory === true,
    guidType: fp?.guidType === true,
    nameCategory: fp?.nameCategory === true,
    nameType: fp?.nameType === true,
  };
}

function serializeBusinessState(state: HoldingV2PersistedState): string {
  const legal = state.legalLinks
    .filter((l) => l.linkActive)
    .map((l) => ({
      c: l.guidClient.toLowerCase(),
      h: l.guidHoldingRoot.toLowerCase(),
      head: l.isHoldingHead ? 1 : 0,
    }))
    .sort((a, b) => a.c.localeCompare(b.c) || a.h.localeCompare(b.h));

  const outlets = state.outletLinks
    .filter((o) => o.linkActive)
    .map((o) => ({
      s: o.guidStore.toLowerCase(),
      h: o.guidHoldingRoot.toLowerCase(),
      closed: o.closureKnown ? (o.isClosed ? 1 : 0) : null,
    }))
    .sort((a, b) => a.s.localeCompare(b.s) || a.h.localeCompare(b.h));

  const tc = [
    ...state.clientTypeCategories.map((r) => ({
      scope: "client" as const,
      key: r.guidClient.toLowerCase(),
      obj: r.objectPresentInSource ? 1 : 0,
      fp: normalizeFieldPresence(r.fieldPresence),
      gt: r.guidType,
      nt: r.nameType,
      gc: r.guidCategory,
      nc: r.nameCategory,
    })),
    ...state.outletTypeCategories.map((r) => ({
      scope: "outlet" as const,
      key: r.guidStore.toLowerCase(),
      obj: r.objectPresentInSource ? 1 : 0,
      fp: normalizeFieldPresence(r.fieldPresence),
      gt: r.guidType,
      nt: r.nameType,
      gc: r.guidCategory,
      nc: r.nameCategory,
    })),
  ].sort((a, b) => a.scope.localeCompare(b.scope) || a.key.localeCompare(b.key));

  return JSON.stringify({ legal, outlets, tc });
}

export function computeBusinessStateSha256(state: HoldingV2PersistedState): string {
  return sha256Hex(Buffer.from(serializeBusinessState(state), "utf8"));
}

/** @deprecated use computeBusinessStateSha256 on projected/persisted state */
export function computePersistedNormalizedStateSha256(state: HoldingV2PersistedState): string {
  return computeBusinessStateSha256(state);
}
