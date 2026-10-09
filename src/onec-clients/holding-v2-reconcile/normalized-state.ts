import { sha256Hex } from "../sha256";
import type { HoldingV2DesiredSnapshot, HoldingV2PersistedState } from "./types";

function serializeDesired(desired: HoldingV2DesiredSnapshot): string {
  const legal = desired.legalLinks.map((l) => ({
    c: l.guidClient,
    h: l.guidHoldingRoot,
    head: l.isHoldingHead ? 1 : 0,
  }));
  const outlets = desired.outletLinks.map((o) => ({
    s: o.guidStore,
    h: o.guidHoldingRoot,
    closed: o.closureKnown ? (o.isClosed ? 1 : 0) : null,
  }));
  const tc = desired.typeCategoryPatches.map((p) => ({
    scope: p.scope,
    key: p.key,
    obj: p.objectPresentInSource ? 1 : 0,
    fp: p.fieldPresence,
    gt: p.guidType,
    nt: p.nameType,
    gc: p.guidCategory,
    nc: p.nameCategory,
  }));
  return JSON.stringify({ legal, outlets, tc });
}

export function computeDesiredNormalizedStateSha256(desired: HoldingV2DesiredSnapshot): string {
  return sha256Hex(Buffer.from(serializeDesired(desired), "utf8"));
}

function serializePersisted(state: HoldingV2PersistedState): string {
  const legal = state.legalLinks
    .filter((l) => l.linkActive)
    .map((l) => ({
      c: l.guidClient,
      h: l.guidHoldingRoot,
      head: l.isHoldingHead ? 1 : 0,
    }))
    .sort((a, b) => a.c.localeCompare(b.c));
  const outlets = state.outletLinks
    .filter((o) => o.linkActive)
    .map((o) => ({
      s: o.guidStore,
      h: o.guidHoldingRoot,
      closed: o.closureKnown ? (o.isClosed ? 1 : 0) : null,
    }))
    .sort((a, b) => a.s.localeCompare(b.s));
  const tcClients = state.clientTypeCategories
    .map((r) => ({
      scope: "client",
      key: r.guidClient,
      obj: r.objectPresentInSource ? 1 : 0,
      fp: r.fieldPresence,
      gt: r.guidType,
      nt: r.nameType,
      gc: r.guidCategory,
      nc: r.nameCategory,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const tcOutlets = state.outletTypeCategories
    .map((r) => ({
      scope: "outlet",
      key: r.guidStore,
      obj: r.objectPresentInSource ? 1 : 0,
      fp: r.fieldPresence,
      gt: r.guidType,
      nt: r.nameType,
      gc: r.guidCategory,
      nc: r.nameCategory,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return JSON.stringify({ legal, outlets, tc: [...tcClients, ...tcOutlets] });
}

export function computePersistedNormalizedStateSha256(state: HoldingV2PersistedState): string {
  return sha256Hex(Buffer.from(serializePersisted(state), "utf8"));
}
