import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { GUID, normalizeSearch, type Product } from "../internal-catalog/model";
import { BUYER_FIELDS, buyerFields, buyerValues } from "./catalog-buyer-facets";
import { catalogModelName } from "./catalog-models";
import {
  isNativeMainMenuText, isNativeTrackerMenuText, isNativeContinueDraftText, isNativeCreateMenuText,
} from "./native-create/main-menu";
import {
  buildCatalogBotReply, catalogBotReply, catalogCallback, CATALOG_BOT_SECTIONS,
  isCatalogRequest, parseCatalogCallback, restrictCatalogBotView, readCatalogPhoto,
  type CatalogBotReply, type CatalogView, type CatalogPhoto,
} from "./catalog";

type Channel = "telegram" | "max";
type Choice = { text: string; data: string };
type Action =
  | { kind: "legacy"; callback: string }
  | { kind: "fields"; page: number }
  | { kind: "values"; field: string; page: number }
  | { kind: "pick"; field: string; value: string }
  | { kind: "search" | "clear" | "list" };
export type CatalogBrowseState = {
  version: 4; revision: string; snapshotId: string; category: string;
  query: string; filters: Record<string, string>; awaitingSearch: boolean;
  listPage: number;
  actions: Action[];
};
export type CatalogBrowseInput = {
  text: string | null; callback: string | null; state: CatalogBrowseState | null;
};
const FIELDS: readonly string[] = BUYER_FIELDS;
const PAGE = 8;
const clean = (s: string, max = 100) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const allowedField = (s: string) => FIELDS.some(f => f === s);
const section = (id: string) => CATALOG_BOT_SECTIONS.find(s => s.guid === id);
const callbackMatch = (s: string) => /^cat2:([a-f0-9]{16}):(0|[1-9]\d?)$/.exec(s);
const cancelSearch = (s: string | null | undefined) => /^(?:отмена|назад|\/cancel)$/i.test(s?.trim() ?? "");

/** Only explicit search mode captures plain text. Commands, receipt/link codes,
 * phone numbers and tracker navigation retain their existing handlers. */
export function isCatalogSearchText(text: string | null | undefined): boolean {
  const s = text?.trim() ?? "";
  const digits = s.replace(/\D/g, "");
  const serviceNumber = /^[+\d][\d\s()-]*$/.test(s) &&
    (digits.length === 6 || digits.length >= 10 || s.startsWith("+"));
  return !!s && !serviceNumber && !/^(?:\/|https?:)/i.test(s) &&
    !/https?:\/\//i.test(s) &&
    !/^(?:каталог|тан трекер|назад|отмена|отменить|стоп|помощь|мои передачи|статус трека|получить код(?: при[её]ма)?|код|настройки)$/i.test(s) &&
    !isNativeMainMenuText(s) && !isNativeTrackerMenuText(s) &&
    !isNativeContinueDraftText(s) && !isNativeCreateMenuText(s) &&
    !/^(?:(?:mst|invite|tt|link)[-_:]|er[A-Za-z0-9_-]{43}$)/i.test(s);
}

function validState(value: unknown): value is CatalogBrowseState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as CatalogBrowseState;
  return s.version === 4 && /^[a-f0-9]{16}$/.test(s.revision) &&
    GUID.test(s.snapshotId) && !!section(s.category) &&
    typeof s.query === "string" && s.query.length <= 80 &&
    Number.isInteger(s.listPage) && s.listPage >= 0 && s.listPage <= 9999 &&
    typeof s.awaitingSearch === "boolean" && !!s.filters &&
    typeof s.filters === "object" && !Array.isArray(s.filters) &&
    Object.entries(s.filters).length <= FIELDS.length &&
    Object.entries(s.filters).every(([k, v]) => allowedField(k) && typeof v === "string" && v.length <= 100) &&
    Array.isArray(s.actions) && s.actions.length <= 32 &&
    s.actions.every(a => {
      if (!a || typeof a !== "object") return false;
      if (a.kind === "legacy") return typeof a.callback === "string" && !!parseCatalogCallback(a.callback);
      if (a.kind === "search" || a.kind === "clear" || a.kind === "list") return true;
      if (a.kind === "pick") return allowedField(a.field) && typeof a.value === "string" && a.value.length <= 100;
      if (a.kind === "fields" || a.kind === "values") return Number.isInteger(a.page) && a.page >= 0 &&
        a.page <= 9999 && (a.kind !== "values" || allowedField(a.field));
      return false;
    }) &&
    JSON.stringify(s).length <= 16000;
}

/** State lives only in the existing committed reply envelope, not tracker
 * drafts. The latest reply (including non-catalogue replies) invalidates it.
 * Read one row, scoped to channel + dialog + sender, with a 30-minute TTL.
 * Static table names below are NOT derived from incoming messages. */
export async function readCatalogBrowseInput(
  db: PoolClient, channel: Channel, chatId: bigint, userId: bigint,
  text?: string | null, callback?: string | null,
): Promise<CatalogBrowseInput | null> {
  // Telegram private dialogs have no independent dialog/user address.
  if (channel === "telegram" && chatId !== userId) return null;
  const explicit = isCatalogRequest(text, callback);
  if (!explicit && (callback || (!isCatalogSearchText(text) && !cancelSearch(text)))) return null;
  if (explicit && !callback?.startsWith("cat2:")) {
    return { text: text ?? null, callback: callback ?? null, state: null };
  }
  const result = channel === "telegram"
    ? await db.query<{ state: unknown }>(`
        SELECT reply_extra->'catalogBrowse' AS state FROM tanbot_telegram_update_dedup
        WHERE status='committed' AND reply_chat_id=$1
          AND received_at > NOW()-INTERVAL '30 minutes'
        ORDER BY received_at DESC,update_id DESC LIMIT 1`, [chatId.toString()])
    : await db.query<{ state: unknown }>(`
        SELECT reply_extra->'catalogBrowse' AS state FROM tanbot_max_update_dedup
        WHERE status='committed' AND reply_chat_id=$1 AND reply_user_id=$2
          AND received_at > NOW()-INTERVAL '30 minutes'
        ORDER BY received_at DESC,dedup_key DESC LIMIT 1`, [chatId.toString(), userId.toString()]);
  const raw = result.rows[0]?.state;
  const state = validState(raw) ? raw : null;
  if (!explicit && !state?.awaitingSearch) return null;
  return { text: text ?? null, callback: callback ?? null, state };
}

function propertyValues(p: Product, field: string): string[] {
  return buyerValues(p, field);
}
export function filteredCatalogView(view: CatalogView, state: Pick<CatalogBrowseState, "category" | "filters" | "query">): CatalogView {
  const words = normalizeSearch(state.query).split(" ").filter(Boolean);
  return { ...view, products: view.products.filter(p =>
    p.guid_group === state.category && words.every(w => normalizeSearch(catalogModelName(p)).includes(w)) &&
    Object.entries(state.filters).every(([field, value]) =>
      propertyValues(p, field).some(v => normalizeSearch(v) === value))) };
}
function valuesFor(view: CatalogView, state: CatalogBrowseState, field: string): string[] {
  const filters = { ...state.filters }; delete filters[field];
  const values = new Map<string, string>();
  for (const p of filteredCatalogView(view, { ...state, filters }).products) {
    for (const v of propertyValues(p, field)) if (!values.has(normalizeSearch(v))) values.set(normalizeSearch(v), v);
  }
  return [...values.values()].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
}
function legacyChoices(r: CatalogBotReply): Choice[] {
  if (r.inlineButtons) return r.inlineButtons.flat().map(b => ({
    text: b.text, data: "payload" in b ? b.payload : "",
  }));
  return ((r.replyMarkup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard)
    .flat().map(b => ({ text: b.text, data: b.callback_data }));
}
function summary(state: CatalogBrowseState): string {
  const parts = [
    ...(state.query ? [`Название: ${state.query}`] : []),
    ...Object.entries(state.filters).map(([k, v]) => `${k}: ${v}`),
  ];
  return parts.length ? `\n\nОтбор:\n${clean(parts.join("; "), 500)}` : "";
}

/** All callbacks address an immutable action in the last reply, not a product
 * row offset or a client-supplied facet. UUID + snapshot remain authoritative.
 * A new reply rotates revision; old/foreign/expired buttons never select data. */
export function buildCatalogBrowseReply(
  channel: Channel, original: CatalogView | null, input: CatalogBrowseInput,
): CatalogBotReply {
  const view = original ? restrictCatalogBotView(original) : null;
  const root = () => buildCatalogBotReply(channel, view, null);
  if (!view?.products.length || input.callback === "cat:root" || (!input.callback && !input.state)) return root();
  let state: CatalogBrowseState;
  let action: Action = { kind: "list" };
  let notice = "";
  if (input.callback?.startsWith("cat2:") || (!input.callback && input.state)) {
    if (!input.state || input.state.snapshotId !== view.snapshotId) {
      const r = root();
      r.text = "Кнопка устарела или каталог обновился. Выберите категорию заново.\n\n" + r.text;
      return r;
    }
    state = { ...input.state, filters: { ...input.state.filters }, actions: [] };
    if (input.callback) {
      const parsed = callbackMatch(input.callback);
      const selected = parsed?.[1] === input.state.revision ? input.state.actions[Number(parsed[2])] : undefined;
      if (!selected) notice = "Кнопка устарела. Продолжите с актуальными кнопками.\n\n";
      else action = selected;
    } else if (!cancelSearch(input.text)) {
      const query = clean(input.text ?? "", 81);
      if (!query || query.length > 80) {
        notice = "Введите от 1 до 80 символов названия.\n\n";
        action = { kind: "search" };
      } else { state.query = query; state.listPage = 0; }
    }
  } else {
    const parsed = parseCatalogCallback(input.callback ?? "");
    if (!parsed || parsed.tag !== view.snapshotId.replace(/-/g, "").slice(0, 12)) {
      return buildCatalogBotReply(channel, view, input.callback);
    }
    const category = parsed.action === "p"
      ? view.products.find(p => p.guid === parsed.id)?.guid_group : parsed.id;
    if (!category || !section(category)) return buildCatalogBotReply(channel, view, input.callback);
    state = { version: 4, revision: "", snapshotId: view.snapshotId, category,
      filters: {}, query: "", awaitingSearch: false, listPage: 0, actions: [] };
    action = { kind: "legacy", callback: parsed.action === "g"
      ? catalogCallback("l", view.snapshotId, category, parsed.page) : input.callback! };
  }
  state.revision = randomBytes(8).toString("hex");
  state.awaitingSearch = false;
  const choose = (text: string, a: Action): Choice => {
    const index = state.actions.push(a) - 1;
    return { text: clean(text, 90), data: `cat2:${state.revision}:${index}` };
  };
  const listButton = () => choose("К моделям", { kind: "list" });
  const finish = (text: string, choices: Choice[], photo?: CatalogPhoto) => {
    const r = catalogBotReply(channel, notice + text, choices, photo);
    r.replyExtra.catalogBrowse = state;
    return r;
  };
  const heading = `Каталог · ${section(state.category)!.name}`;
  if (action.kind === "clear") { state.filters = {}; state.query = ""; state.listPage = 0; }
  if (action.kind === "pick") {
    state.listPage = 0;
    if (allowedField(action.field)) {
      if (!action.value) delete state.filters[action.field];
      else if (valuesFor(view, state, action.field).some(v => normalizeSearch(v) === action.value)) {
        state.filters[action.field] = action.value;
      }
    }
  }
  if (action.kind === "search") {
    state.awaitingSearch = true;
    return finish(`${heading}\n\nВведите часть названия модели одним сообщением (до 80 символов). ` +
      `Выбранные фильтры сохранятся. Команды ТанТрекера не используются как поиск.${summary(state)}`,
    [listButton(), choose("Сбросить отбор", { kind: "clear" })]);
  }
  if (action.kind === "fields" || action.kind === "values") {
    const available = buyerFields(state.category);
    const field = action.kind === "values" && available.includes(action.field) ? action.field : null;
    const fields = field ? [] : available.filter(f => !!state.filters[f] || valuesFor(view, state, f).length > 0);
    const items = field ? valuesFor(view, state, field) : fields;
    const current = Math.max(0, Math.min(action.page, Math.ceil(items.length / PAGE) - 1));
    const buttons = items.slice(current * PAGE, (current + 1) * PAGE).map(value => field
      ? choose((state.filters[field] === normalizeSearch(value) ? "Выбрано: " : "") + value,
        { kind: "pick", field, value: normalizeSearch(value) })
      : choose((state.filters[value] ? "Выбрано: " : "") + value, { kind: "values", field: value, page: 0 }));
    const pageAction = (page: number): Action => field
      ? { kind: "values", field, page } : { kind: "fields", page };
    if (current > 0) buttons.push(choose("Назад", pageAction(current - 1)));
    if ((current + 1) * PAGE < items.length) buttons.push(choose("Далее", pageAction(current + 1)));
    if (field && state.filters[field]) buttons.push(choose("Любое значение", { kind: "pick", field, value: "" }));
    if (field) buttons.push(choose("Все фильтры", { kind: "fields", page: 0 }));
    buttons.push(listButton(), choose("Сбросить отбор", { kind: "clear" }));
    return finish(`${heading}\n\n${field ? `Выберите: ${field}.` :
      fields.length ? "Основные фильтры. Можно сочетать несколько условий." :
        "Для текущего отбора нет различающихся характеристик. Измените название или сбросьте отбор."}${summary(state)}`, buttons);
  }
  const filtered = filteredCatalogView(view, state);
  const callback = action.kind === "legacy" ? action.callback
    : catalogCallback("l", view.snapshotId, state.category, state.listPage);
  const parsed = parseCatalogCallback(callback);
  if (parsed?.action === "g") return buildCatalogBotReply(channel, view, callback);
  if (parsed?.action === "l") state.listPage = parsed.page;
  // Expand all panel colours only for entrance-door galleries.
  // Other categories keep the single photo within the selected filters.
  const galleryView = parsed?.action === "p" && parsed.page === 0 &&
    state.category === CATALOG_BOT_SECTIONS[0].guid &&
    filtered.products.some(p => p.guid === parsed.id)
    ? { ...view, products: view.products.filter(p => p.guid_group === state.category) } : filtered;
  const legacy = buildCatalogBotReply(channel, galleryView, callback);
  const photo = readCatalogPhoto(legacy.replyExtra);
  const buttons = [
    ...(!photo ? [
      choose("Фильтры", { kind: "fields", page: 0 }),
      choose("Найти по названию", { kind: "search" }),
      ...(state.query || Object.keys(state.filters).length ? [choose("Сбросить отбор", { kind: "clear" })] : []),
    ] : []),
    ...legacyChoices(legacy).filter(b => b.data.startsWith("cat:"))
      .map(b => choose(b.text, { kind: "legacy", callback:
        legacy.replyExtra.catalogPhoto && parseCatalogCallback(b.data)?.action === "l"
          ? catalogCallback("l", view.snapshotId, state.category, state.listPage) : b.data })),
  ];
  if (!filtered.products.length) buttons.push(choose("Категории", {
    kind: "legacy", callback: catalogCallback("g", view.snapshotId),
  }));
  const text = filtered.products.length ? legacy.text.replace("Выберите модель.",
    "Выберите модель или сузьте список фильтрами и поиском по названию.") :
    `${heading}\n\nПо этому отбору моделей с фото не найдено. Измените название или сбросьте отбор.`;
  const result = finish((text + (photo ? "" : summary(state))).slice(0, photo ? 950 : 3500),
    buttons, photo ?? undefined);
  if (legacy.replyExtra.catalogGallery) result.replyExtra.catalogGallery = legacy.replyExtra.catalogGallery;
  return result;
}
