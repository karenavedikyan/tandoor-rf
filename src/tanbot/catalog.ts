import type { Pool, PoolClient } from "pg";
import { loadSnapshot } from "../internal-catalog/repository";
import { GUID, safeImagePath, normalizeSearch, type Product } from "../internal-catalog/model";
import { buildCatalogContext, groupDescendants, type CatalogContext, type Group, type SourceRow } from "../internal-catalog/presentation";
import { catalogModels } from "./catalog-models";
import { readThumbnail, THUMBNAIL_RECIPE } from "../internal-catalog/thumbnails";
import { buildNativeCreateCallback } from "./native-create/callback-codec";
import { NATIVE_MENU_DRAFT_HEX } from "./native-create/menu-sentinel";
import type { MaxInlineButton } from "../tanbot-max/delivery-transport";

type Db = Pool | PoolClient;
type Channel = "telegram" | "max";
type Choice = { text: string; data: string };
export type CatalogPhoto = { snapshotId: string; productGuid: string; fileGuid: string };
export type CatalogBotReply = {
  text: string;
  replyMarkup?: Record<string, unknown>;
  inlineButtons?: MaxInlineButton[][];
  replyExtra: Record<string, unknown>;
};
export type CatalogView = {
  snapshotId: string;
  products: Product[];
  context: CatalogContext;
  /** Verified hashes of the actual bot preview, keyed by normalized source path.
   * Snapshot-local, never included in messenger replies or source records. */
  photoHashes?: ReadonlyMap<string, string>;
};
const PAGE_SIZE = 8;
const ROOT = "-";
/** Bot-only navigation IDs. Source SKU/file/group records are never changed. */
export const CATALOG_BOT_SECTIONS = [
  { guid: "ca7a1000-0000-4000-8000-000000000001", name: "Входные двери" },
  { guid: "ca7a1000-0000-4000-8000-000000000002", name: "Межкомнатные двери" },
  { guid: "ca7a1000-0000-4000-8000-000000000003", name: "Фурнитура" },
] as const;
function catalogSection(product: Product, groups: ReadonlyMap<string, Group>) {
  const evidence = [...product.chapter.map(c => c.name), product.name_group ?? "",
    ...product.properties.filter(p => ["Тип товара", "Вид двери"].includes(p.name.trim())).map(p => p.value)];
  const seen = new Set<string>();
  let cursor = product.guid_group;
  while (cursor) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const group = groups.get(cursor);
    if (!group) break;
    if (group.conflict) return null;
    evidence.push(group.name); cursor = group.parent ?? undefined;
  }
  // Door leaves also carry the compatible trim system ("Телескопический
  // погонаж"). Its presence alone does not make the leaf a trim product.
  // Actual component types and denied catalogue branches still stay excluded.
  if (product.properties.some(p => p.name.trim() === "Тип погонажа" &&
      /наличник|добор|короб|плинтус/.test(normalizeSearch(p.value)))) return null;
  const sections = new Set<number>();
  let hasFloorWording = false;
  for (const raw of evidence) {
    const value = normalizeSearch(raw);
    // Deny rules take precedence even inside an otherwise allowed door branch.
    if (/погонаж|напольн[а-я]*\s+покрыт|ламинат|линолеум|паркет|кварц.?винил|плитк|керамогранит|ковролин|плинтус|наличник|добор|коробочн|коробк/.test(value)) return null;
    if (/напольн/.test(value)) hasFloorWording = true;
    if (/фурнитур/.test(value)) sections.add(2);
    else if (/межкомнатн/.test(value)) sections.add(1);
    else if (/входн|металлическ[а-я]*\s+двер/.test(value)) sections.add(0);
  }
  const values = (field: string) => product.properties.filter(p => p.name.trim() === field)
    .map(p => normalizeSearch(p.value))
    .filter(v => !["", "-", "не указан", "не указано", "не задан", "не задано"].includes(v));
  // Only genuinely ungrouped records get this fallback. Never repair a broken
  // hierarchy, override a denied branch, or guess the category from SKU text.
  if (!product.guid_group) {
    if (values("Тип фурнитуры").some(v => v !== "нет")) sections.add(2);
    if (values("Вид двери").some(v =>
      /^(?:глухая(?:\s*\(дг\))?|стеклянная(?:\s*\(до\))?|частично остекленная(?:\s*\(дч\))?)$/.test(v))) sections.add(1);
    if (["ВХ. По назначению", "ВХ. Терморазрыв", "ВХ. Стеклопакет"]
      .some(field => values(field).length)) sections.add(0);
  }
  // "Напольный" alone remains denied, except for explicitly typed door stops
  // in the hardware category. Real flooring branches were rejected above.
  if (hasFloorWording && !(sections.size === 1 && sections.has(2) &&
      values("Тип фурнитуры").includes("ограничитель"))) return null;
  return sections.size === 1 ? CATALOG_BOT_SECTIONS[[...sections][0]] : null;
}
/** Fixed three-section bot projection, not a change to the internal catalogue. */
export function restrictCatalogBotView(view: CatalogView): CatalogView {
  const groups = new Map(view.context.groups.map(g => [g.guid, g]));
  const products = view.products.flatMap(p => {
    const section = p.files.length ? catalogSection(p, groups) : null;
    return section ? [{ ...p, guid_group: section.guid, name_group: section.name }] : [];
  });
  return { ...view, products, context: { ...view.context,
    groups: CATALOG_BOT_SECTIONS.filter(s => products.some(p => p.guid_group === s.guid))
      .map(s => ({ ...s, parent: null, conflict: false })) } };
}
const compact = (id: string) => id.replace(/-/g, "");
const expand = (id: string) => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
const label = (text: string, max = 90) => text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** A narrow opt-in public projection, NOT access to internal-catalog HTTP routes. */
export function isCatalogRequest(text: string | null | undefined, callback?: string | null): boolean {
  return !!callback?.startsWith("cat:") || !!callback?.startsWith("cat2:") ||
    /^(?:каталог|\/catalog(?:@[a-z0-9_]+)?)$/i.test(text?.trim() ?? "");
}

/** Snapshot tag prevents an old button from selecting a new snapshot's model.
 * UUIDs, not row offsets, address models; pagination stays within 64 UTF-8 bytes.
 */
export function catalogCallback(action: "g" | "l" | "p", snapshot: string, id = ROOT, page = 0): string {
  if (!GUID.test(snapshot) || (id !== ROOT && !GUID.test(id)) || !Number.isInteger(page) || page < 0 || page > 9999) {
    throw new Error("INVALID_CATALOG_CALLBACK");
  }
  return `cat:${action}:${compact(snapshot).slice(0, 12)}:${id === ROOT ? ROOT : compact(id)}:${page}`;
}
export function parseCatalogCallback(value: string) {
  const match = /^cat:([glp]):([a-f0-9]{12}):(-|[a-f0-9]{32}):(0|[1-9]\d{0,3})$/.exec(value);
  return match ? { action: match[1] as "g" | "l" | "p", tag: match[2],
    id: match[3] === ROOT ? ROOT : expand(match[3]), page: Number(match[4]) } : null;
}

/** Only persisted, bounded, checksum-verified images qualify. No FTP, image
 * processing, imports, jobs or writes are initiated while browsing the bot.
 * Partial thumbnail preparation is useful here, without changing the LK switch.
 */
export async function loadCatalogBotView(db: Db): Promise<CatalogView | null> {
  const snapshot = await loadSnapshot(db);
  if (!snapshot) return null;
  // Check before querying: catching undefined_table inside the webhook's
  // transaction would still leave PostgreSQL in an aborted transaction.
  const schema = await db.query<{ media_table: string | null }>(
    "SELECT to_regclass('internal_catalog_thumbnails')::text AS media_table");
  if (!schema.rows[0]?.media_table) {
    return { snapshotId: snapshot.id, products: [], context: { groups: [], commerce: new Map(), priceTypes: [] } };
  }
  const products = await db.query<{ record: Product; photo_hashes: Record<string, string> }>(`
      SELECT jsonb_set(p.record,'{files}',jsonb_agg(f ORDER BY ord)) AS record,
        jsonb_object_agg(replace(f->>'path',chr(92),'/'),t.list_sha256) AS photo_hashes
      FROM internal_catalog_products p
      CROSS JOIN LATERAL jsonb_array_elements(p.record->'files') WITH ORDINALITY AS files(f,ord)
      JOIN internal_catalog_thumbnails t ON t.snapshot_id=p.snapshot_id
        AND t.source_path=replace(f->>'path',chr(92),'/') AND t.recipe=$2
        AND t.status='ready' AND octet_length(t.list_bytes) BETWEEN 1 AND 131072
        AND encode(sha256(t.list_bytes),'hex')=t.list_sha256
      WHERE p.snapshot_id=$1::uuid GROUP BY p.snapshot_id,p.guid ORDER BY p.guid`,
    [snapshot.id, THUMBNAIL_RECIPE]);
  const context = await loadBotCatalogGroups(db);
  return restrictCatalogBotView({ snapshotId: snapshot.id, products: products.rows.map(r => r.record), context,
    photoHashes: new Map(products.rows.flatMap(r => Object.entries(r.photo_hashes))) });
}

/** No prices/stocks/commerce needed for a public name-and-photo catalogue.
 * Keep group conflicts current; no cross-request cache or new memory pressure. */
async function loadBotCatalogGroups(db: Db): Promise<CatalogContext> {
  const rows = await db.query<SourceRow>(`SELECT r.file_key,r.record,b.imported_at
    FROM onec_manual_object_versions v JOIN onec_manual_records r
      ON r.batch_id=v.batch_id AND r.entity_kind=v.entity_kind AND r.entity_guid=v.entity_guid AND r.file_key=v.file_key
    JOIN onec_manual_batches b ON b.id=v.batch_id
    WHERE v.entity_kind='group' AND v.file_key='groups'`);
  return buildCatalogContext(rows.rows);
}

function reply(channel: Channel, text: string, choices: Choice[], photo?: CatalogPhoto): CatalogBotReply {
  const menu = buildNativeCreateCallback("menu_home", NATIVE_MENU_DRAFT_HEX, 1)!;
  const buttons = [...choices, { text: "Главное меню", data: menu }];
  const extra: Record<string, unknown> = photo ? { catalogPhoto: photo } : {};
  if (channel === "telegram") {
    const replyMarkup = { inline_keyboard: buttons.map(b => [{ text: b.text, callback_data: b.data }]) };
    return { text, replyMarkup, replyExtra: { ...extra, replyMarkup } };
  }
  const inlineButtons = buttons.map(b => [{ type: "callback" as const, text: b.text, payload: b.data }]);
  return { text, inlineButtons, replyExtra: { ...extra, inlineButtons } };
}
export { reply as catalogBotReply };

function categories(view: CatalogView): Group[] {
  const groups = new Map(view.context.groups.map(g => [g.guid, { ...g }]));
  // Retain source groups even if a group record was not supplied in 1C.
  for (const p of view.products) if (p.guid_group && !groups.has(p.guid_group)) {
    groups.set(p.guid_group, { guid: p.guid_group, name: p.name_group || "Другие модели", parent: null, conflict: false });
  }
  const used = new Set<string>();
  for (const p of view.products) {
    let id = p.guid_group;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id); used.add(id);
      id = groups.get(id)?.parent ?? undefined;
    }
  }
  return [...groups.values()].filter(g => used.has(g.guid))
    .map(g => ({ ...g, parent: g.parent && used.has(g.parent) ? g.parent : null }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.guid.localeCompare(b.guid));
}

/** Pure bot-only name/photo presentation. No commerce, private paths, source
 * records or credentials are ever copied to replies/captions. LK rules unchanged.
 */
export function buildCatalogBotReply(channel: Channel, view: CatalogView | null, callback?: string | null): CatalogBotReply {
  const result = buildCatalogBotContent(channel, view, callback);
  if (channel === "telegram" && (!callback || callback === "cat:root")) {
    result.replyExtra = { ...result.replyExtra, replyKeyboardClear: true };
  }
  return result;
}

function buildCatalogBotContent(channel: Channel, view: CatalogView | null, callback?: string | null): CatalogBotReply {
  if (view) view = restrictCatalogBotView(view);
  if (!view || !view.products.length) {
    return reply(channel, "Каталог\n\nМодели с готовыми фотографиями пока недоступны. Попробуйте позднее.", []);
  }
  const parsed = callback ? parseCatalogCallback(callback) : null;
  const stale = !!callback && (!parsed || parsed.tag !== compact(view.snapshotId).slice(0, 12));
  if (stale) {
    return reply(channel, "Каталог обновился или кнопка устарела. Откройте актуальные категории.",
      [{ text: "Категории", data: catalogCallback("g", view.snapshotId) }]);
  }
  const action = parsed?.action ?? "g", id = parsed?.id ?? ROOT, page = parsed?.page ?? 0;
  const groups = categories(view), group = groups.find(g => g.guid === id);
  const rootChoice = { text: "Категории", data: catalogCallback("g", view.snapshotId) };
  if (id !== ROOT && action !== "p" && !group) {
    return reply(channel, "В этом разделе больше нет доступных фотографий.", [rootChoice]);
  }
  const pageButtons = (count: number, kind: "g" | "l", target: string, current: number): Choice[] => [
    ...(current > 0 ? [{ text: "Назад", data: catalogCallback(kind, view.snapshotId, target, current - 1) }] : []),
    ...((current + 1) * PAGE_SIZE < count ? [{ text: "Далее", data: catalogCallback(kind, view.snapshotId, target, current + 1) }] : []),
  ];
  if (action === "g") {
    const children = groups.filter(g => g.parent === (id === ROOT ? null : id));
    // Leaf category goes straight to models.
    if (!children.length) return buildCatalogBotReply(channel, view, catalogCallback("l", view.snapshotId, id));
    const current = Math.min(page, Math.floor((children.length - 1) / PAGE_SIZE));
    const buttons = children.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
      .map(g => ({ text: label(g.name), data: catalogCallback("g", view.snapshotId, g.guid) }));
    buttons.push(...pageButtons(children.length, "g", id, current));
    if (id !== ROOT) buttons.push({ text: "Все модели раздела", data: catalogCallback("l", view.snapshotId, id) });
    if (id !== ROOT) buttons.push({ text: "К разделам", data: catalogCallback("g", view.snapshotId, group?.parent ?? ROOT) });
    return reply(channel, `Каталог · ${label(group?.name ?? "Категории", 200)}\n\n` +
      (id === ROOT ? "Входные и межкомнатные двери, фурнитура.\n" : "") +
      "Выберите категорию. Показываем только модели с готовыми фото.", buttons);
  }
  if (action === "l") {
    const descendants = new Set(id === ROOT ? [] : groupDescendants(groups, id));
    const families = catalogModels(view.products.filter(p =>
      id === ROOT || (p.guid_group && descendants.has(p.guid_group))));
    const current = Math.min(page, Math.max(0, Math.floor((families.length - 1) / PAGE_SIZE)));
    const buttons = families.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(f => ({
      text: label(f.name),
      data: catalogCallback("p", view.snapshotId, f.products[0].guid),
    }));
    buttons.push(...pageButtons(families.length, "l", id, current), rootChoice);
    return reply(channel, `Каталог · ${label(group?.name ?? "Все модели", 200)}\n\n` +
      (families.length ? `Моделей с фото: ${families.length}. Страница ${current + 1} из ${Math.ceil(families.length / PAGE_SIZE)}.\nВыберите модель.` :
        "В этом разделе пока нет моделей с готовыми фото."), buttons);
  }
  const product = view.products.find(p => p.guid === id);
  if (!product) return reply(channel, "Фотографии этой модели сейчас недоступны.", [rootChoice]);
  const family = catalogModels(view.products).find(f => f.products.some(p => p.guid === id))!;
  const index = Math.min(page, family.photos.length - 1);
  const selected = family.photos[index];
  const choices: Choice[] = [];
  // Only entrance doors need exterior + interior-panel galleries.
  // Other categories send one photo; old photo-page callbacks stay readable.
  const autoGallery = page === 0 && product.guid_group === CATALOG_BOT_SECTIONS[0].guid;
  // The same exterior/interior is often copied into distinct size/handing paths.
  // Compare verified preview content, not file names, dimensions or colours.
  // Keep every distinct panel; absent hashes conservatively retain source paths.
  const seenPhotos = new Set<string>();
  const galleryPhotos = autoGallery ? family.photos.filter(({ file }) => {
    const path = file.path.replace(/\\/g, "/");
    const hash = view.photoHashes?.get(path);
    const key = hash ? `sha256:${hash}` : `path:${path}`;
    if (seenPhotos.has(key)) return false;
    seenPhotos.add(key); return true;
  }) : [];
  if (page > 0) {
    if (index > 0) choices.push({ text: "Предыдущее фото", data: catalogCallback("p", view.snapshotId, id, index - 1) });
    if (index + 1 < family.photos.length) choices.push({ text: "Следующее фото", data: catalogCallback("p", view.snapshotId, id, index + 1) });
  }
  choices.push({ text: "К моделям", data: catalogCallback("l", view.snapshotId, product.guid_group ?? ROOT) }, rootChoice);
  if (autoGallery && galleryPhotos.length > 4096) {
    return reply(channel, "У модели слишком много фото для одной отправки. Обратитесь к менеджеру.", choices);
  }
  const result = reply(channel, label(family.name, 200), choices,
    { snapshotId: view.snapshotId, productGuid: selected.product.guid, fileGuid: selected.file.guid });
  if (autoGallery) result.replyExtra.catalogGallery = galleryPhotos.map(({ product: p, file }) =>
    ({ snapshotId: view.snapshotId, productGuid: p.guid, fileGuid: file.guid }));
  return result;
}

export function readCatalogPhoto(extra: unknown): CatalogPhoto | null {
  const value = extra && typeof extra === "object" ? (extra as Record<string, unknown>).catalogPhoto : null;
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return ["snapshotId", "productGuid", "fileGuid"].every(k => typeof row[k] === "string" && GUID.test(row[k] as string))
    ? { snapshotId: row.snapshotId as string, productGuid: row.productGuid as string, fileGuid: row.fileGuid as string } : null;
}

/** A frozen, bounded queue of public identifiers only. Never persist source
 * URLs, bytes, commerce or characteristics in a messenger reply envelope. */
export function readCatalogGallery(extra: unknown): CatalogPhoto[] | null {
  if (!extra || typeof extra !== "object") return null;
  const raw = (extra as Record<string, unknown>).catalogGallery;
  if (!Array.isArray(raw) || !raw.length || raw.length > 4096) return null;
  const photos = raw.map(item => readCatalogPhoto({ catalogPhoto: item }));
  const first = readCatalogPhoto(extra);
  if (!first || photos.some(p => !p || p.snapshotId !== first.snapshotId) ||
      JSON.stringify(photos[0]) !== JSON.stringify(first)) return null;
  return photos as CatalogPhoto[];
}

/** Revalidate current snapshot + SKU/file membership at send/retry time.
 * Do not expose private source URLs or send another SKU's image on failure.
 */
export async function catalogPhotoBytes(db: Db, photo: CatalogPhoto): Promise<Buffer | null> {
  const snapshot = await loadSnapshot(db);
  if (snapshot?.id !== photo.snapshotId) return null;
  const row = await db.query<{ record: Product }>(
    "SELECT record FROM internal_catalog_products WHERE snapshot_id=$1::uuid AND guid=$2::uuid",
    [photo.snapshotId, photo.productGuid]);
  const file = row.rows[0]?.record.files.find(f => f.guid === photo.fileGuid);
  if (!file || !safeImagePath(file.path)) return null;
  if (!catalogSection(row.rows[0].record, new Map((await loadBotCatalogGroups(db)).groups.map(g => [g.guid, g])))) return null;
  return readThumbnail(db, photo.snapshotId, file.path, "list");
}
