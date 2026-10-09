import type {
  HoldingV2DesiredSnapshot,
  HoldingV2PersistedLegalLink,
  HoldingV2PersistedOutletLink,
  HoldingV2PersistedState,
} from "./types";
import { mergeTypeCategoryPatch, type StoredTypeCategory } from "./type-category-merge";

function clonePersistedState(persisted: HoldingV2PersistedState): {
  legalByClient: Map<string, HoldingV2PersistedLegalLink>;
  outletByStore: Map<string, HoldingV2PersistedOutletLink>;
  clientTc: Map<string, StoredTypeCategory & { guidClient: string }>;
  outletTc: Map<string, StoredTypeCategory & { guidStore: string }>;
} {
  const legalByClient = new Map<string, HoldingV2PersistedLegalLink>();
  for (const link of persisted.legalLinks) {
    legalByClient.set(link.guidClient.toLowerCase(), { ...link });
  }
  const outletByStore = new Map<string, HoldingV2PersistedOutletLink>();
  for (const link of persisted.outletLinks) {
    outletByStore.set(link.guidStore.toLowerCase(), { ...link });
  }
  const clientTc = new Map<string, StoredTypeCategory & { guidClient: string }>();
  for (const row of persisted.clientTypeCategories) {
    clientTc.set(row.guidClient.toLowerCase(), {
      guidClient: row.guidClient.toLowerCase(),
      objectPresentInSource: row.objectPresentInSource,
      fieldPresence: {
        guidType: row.fieldPresence.guidType === true,
        nameType: row.fieldPresence.nameType === true,
        guidCategory: row.fieldPresence.guidCategory === true,
        nameCategory: row.fieldPresence.nameCategory === true,
      },
      guidType: row.guidType,
      nameType: row.nameType,
      guidCategory: row.guidCategory,
      nameCategory: row.nameCategory,
    });
  }
  const outletTc = new Map<string, StoredTypeCategory & { guidStore: string }>();
  for (const row of persisted.outletTypeCategories) {
    outletTc.set(row.guidStore.toLowerCase(), {
      guidStore: row.guidStore.toLowerCase(),
      objectPresentInSource: row.objectPresentInSource,
      fieldPresence: {
        guidType: row.fieldPresence.guidType === true,
        nameType: row.fieldPresence.nameType === true,
        guidCategory: row.fieldPresence.guidCategory === true,
        nameCategory: row.fieldPresence.nameCategory === true,
      },
      guidType: row.guidType,
      nameType: row.nameType,
      guidCategory: row.guidCategory,
      nameCategory: row.nameCategory,
    });
  }
  return { legalByClient, outletByStore, clientTc, outletTc };
}

export function projectHoldingV2BusinessState(
  persisted: HoldingV2PersistedState,
  desired: HoldingV2DesiredSnapshot,
): HoldingV2PersistedState {
  const { legalByClient, outletByStore, clientTc, outletTc } = clonePersistedState(persisted);

  for (const link of desired.legalLinks) {
    const key = link.guidClient.toLowerCase();
    legalByClient.set(key, {
      guidClient: key,
      guidHoldingRoot: link.guidHoldingRoot.toLowerCase(),
      isHoldingHead: link.isHoldingHead,
      linkActive: true,
    });
  }

  for (const link of desired.outletLinks) {
    const key = link.guidStore.toLowerCase();
    outletByStore.set(key, {
      guidStore: key,
      guidHoldingRoot: link.guidHoldingRoot.toLowerCase(),
      isClosed: link.closureKnown ? link.isClosed : null,
      closureKnown: link.closureKnown,
      linkActive: true,
    });
  }

  for (const holdingRoot of desired.membershipCompleteHoldings) {
    const root = holdingRoot.toLowerCase();
    const desiredLegalIds = new Set(
      desired.legalLinks
        .filter((l) => l.guidHoldingRoot.toLowerCase() === root)
        .map((l) => l.guidClient.toLowerCase()),
    );
    const desiredOutletIds = new Set(
      desired.outletLinks
        .filter((o) => o.guidHoldingRoot.toLowerCase() === root)
        .map((o) => o.guidStore.toLowerCase()),
    );

    for (const [clientId, legal] of legalByClient) {
      if (!legal.linkActive || legal.guidHoldingRoot.toLowerCase() !== root) {
        continue;
      }
      if (!desiredLegalIds.has(clientId)) {
        legalByClient.set(clientId, { ...legal, linkActive: false });
      }
    }
    for (const [storeId, outlet] of outletByStore) {
      if (!outlet.linkActive || outlet.guidHoldingRoot.toLowerCase() !== root) {
        continue;
      }
      if (!desiredOutletIds.has(storeId)) {
        outletByStore.set(storeId, { ...outlet, linkActive: false });
      }
    }
  }

  for (const patch of desired.typeCategoryPatches) {
    if (patch.scope === "client") {
      const key = patch.key.toLowerCase();
      const merged = mergeTypeCategoryPatch(clientTc.get(key), patch);
      clientTc.set(key, { guidClient: key, ...merged });
    } else {
      const key = patch.key.toLowerCase();
      const merged = mergeTypeCategoryPatch(outletTc.get(key), patch);
      outletTc.set(key, { guidStore: key, ...merged });
    }
  }

  return {
    legalLinks: [...legalByClient.values()],
    outletLinks: [...outletByStore.values()],
    clientTypeCategories: [...clientTc.values()].map((r) => ({
      guidClient: r.guidClient,
      objectPresentInSource: r.objectPresentInSource,
      fieldPresence: r.fieldPresence,
      guidType: r.guidType,
      nameType: r.nameType,
      guidCategory: r.guidCategory,
      nameCategory: r.nameCategory,
    })),
    outletTypeCategories: [...outletTc.values()].map((r) => ({
      guidStore: r.guidStore,
      objectPresentInSource: r.objectPresentInSource,
      fieldPresence: r.fieldPresence,
      guidType: r.guidType,
      nameType: r.nameType,
      guidCategory: r.guidCategory,
      nameCategory: r.nameCategory,
    })),
  };
}
