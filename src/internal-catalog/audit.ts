import { propertyValue, type Product } from "./model";
import { commerceFor, type CatalogContext } from "./presentation";
import { conflictingConfigurationFields, productFamilies, productSize, sizeModelKey } from "./variants";

/** Entire immutable snapshot, never search/page-dependent. Diagnostic only; no repairs or writes. */
export function auditCatalog(products: Product[], context: CatalogContext, priceType: string) {
  const families = productFamilies(products, context, priceType);
  const assigned = families.flatMap(f => f.products.map(p => p.guid)), unique = new Set(assigned);
  const familyByGuid = new Map(families.flatMap((f, i) => f.products.map(p => [p.guid, i] as const)));
  const candidates = new Map<string, Product[]>();
  // Keep legacy metadata counters for API compatibility. Only price validity gates grouping.
  const ineligible = { invalidSize: 0, missingLink: 0, dimensionMismatch: 0, unknownPrice: 0, conflictingPrice: 0 };
  const price = (p: Product) => commerceFor(context, p.guid).prices.find(x => x.guid === priceType);
  for (const product of products) {
    const key = sizeModelKey(product), value = price(product);
    if (!productSize(product)) ineligible.invalidSize++;
    else if (!propertyValue(product, "СсылкаНаГлавную")) ineligible.missingLink++;
    else if (!key) ineligible.dimensionMismatch++;
    if (!value || value.value === null) ineligible.unknownPrice++;
    if (value?.conflict) ineligible.conflictingPrice++;
    if (!key) continue;
    const group = candidates.get(key) ?? []; group.push(product); candidates.set(key, group);
  }
  const models = [...candidates.values()].filter(group => group.length > 1);
  const unresolved = models.filter(group => new Set(group.map(p => familyByGuid.get(p.guid))).size > 1).map(group => {
    const reasons: string[] = [], fields = conflictingConfigurationFields(group);
    if (group.some(p => !price(p) || price(p)!.value === null)) reasons.push("unknown_price");
    if (group.some(p => price(p)?.conflict)) reasons.push("conflicting_price");
    if (new Set(group.map(p => price(p)).filter(p => p && p.value !== null && !p.conflict)
      .map(p => p!.value)).size > 1) reasons.push("different_price");
    return { name: group[0].name, products: group.length,
      cards: new Set(group.map(p => familyByGuid.get(p.guid))).size, reasons, fields,
      variants: group.map(p => ({ guid: p.guid, name: p.name, size: productSize(p) })) };
  });
  const reasonCounts: Record<string, number> = {}, fieldCounts: Record<string, number> = {};
  for (const model of unresolved) {
    for (const reason of model.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    for (const field of model.fields) fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
  }
  const ruleViolations = models.filter(group => {
    const known = new Map<number, Set<number | undefined>>();
    for (const p of group) {
      const value = price(p);
      if (!value || value.conflict || value.value === null) continue;
      const cards = known.get(value.value) ?? new Set();
      cards.add(familyByGuid.get(p.guid)); known.set(value.value, cards);
    }
    return [...known.values()].some(cards => cards.size > 1);
  }).length;
  return { policy: "name_price_v1", priceType, products: products.length, cards: families.length, ruleViolations,
    groupedCards: families.filter(f => f.products.length > 1).length,
    productsInGroups: families.filter(f => f.products.length > 1).reduce((sum, f) => sum + f.products.length, 0),
    maxSizes: Math.max(0, ...families.map(f => f.products.length)),
    coverage: { assigned: assigned.length, unique: unique.size,
      ok: assigned.length === products.length && unique.size === products.length && products.every(p => unique.has(p.guid)) },
    ineligible, sizeModels: models.length, unresolvedModels: unresolved.length,
    unexplainedModels: unresolved.filter(m => !m.reasons.length).length, reasonCounts, fieldCounts, unresolved };
}
