import express from "express";
import { qualityForVisibleTargets } from "../onec-manual/quality";
import { query } from "../db/pool";
import { csrfOriginProtection } from "../middleware/csrf";
import { requirePool } from "../db/pool";
import { internalCatalogAccess } from "./access";
import { GUID, normalizeSearch, MAX_JSON_BYTES, parseProductsJson } from "./model";
import { importSnapshot, loadProduct, loadProductVariants, loadSnapshot, searchProducts } from "./repository";
import { internalCatalogImagesConfigured, readInternalCatalogImage } from "./images";
import { loadCatalogContext, loadCatalogFacets } from "./context";
import { CATALOG_FACETS, commerceFor } from "./presentation";

export function createInternalCatalogRouter(): express.Router {
  const router = express.Router();
  router.use(...internalCatalogAccess);
  const wrap = (handler: (req: express.Request, res: express.Response) => Promise<void>): express.RequestHandler =>
    (req, res, next) => { void handler(req, res).catch(next); };
  function invalid(res: express.Response, message = "Проверьте параметры поиска.") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message } });
  }
  const upload = express.raw({ type: "application/octet-stream", limit: MAX_JSON_BYTES });
  router.post("/bootstrap", csrfOriginProtection,
    (req: express.Request, res: express.Response, next: express.NextFunction) => upload(req, res, error => {
      if (error) {
        res.status(error.type === "entity.too.large" ? 413 : 400)
          .json({ error: { code: "INVALID_FILE", message: "Проверьте размер и формат файла." } }); return;
      }
      next();
    }),
    wrap(async (req, res) => {
      if (await loadSnapshot(requirePool())) {
        res.status(409).json({ error: { code: "CATALOG_NOT_EMPTY", message: "Каталог уже загружен." } }); return;
      }
      const expected = req.get("x-content-sha256") ?? "";
      if (!req.is("application/octet-stream") || !Buffer.isBuffer(req.body) ||
          !/^[a-f0-9]{64}$/.test(expected)) { invalid(res, "Проверьте файл и контрольную сумму."); return; }
      try {
        const parsed = parseProductsJson(req.body);
        if (parsed.sha256 !== expected) { invalid(res, "Контрольная сумма не совпала."); return; }
        res.status(201).json(await importSnapshot(requirePool(), parsed, "products.json", expected, true));
      } catch (error) {
        if (error instanceof Error && error.message === "CATALOG_NOT_EMPTY") {
          res.status(409).json({ error: { code: "CATALOG_NOT_EMPTY", message: "Каталог уже загружен." } }); return;
        }
        invalid(res, "Выгрузка не прошла проверку. Данные каталога не изменены.");
      }
    }));
  function field(req: express.Request, name: string, max: number): string | null {
    const value = req.query[name];
    return value === undefined ? "" : typeof value === "string" && value.length <= max ? value : null;
  }
  async function snapshot(req: express.Request, res: express.Response) {
    const version = field(req, "version", 36);
    if (version === null || (version && !GUID.test(version))) { invalid(res); return undefined; }
    const result = await loadSnapshot(requirePool(), version || undefined);
    if (version && !result) {
      res.status(404).json({ error: { code: "SNAPSHOT_NOT_FOUND", message: "Версия каталога не найдена. Обновите страницу." } });
      return undefined;
    }
    return result;
  }
  router.get("/meta", wrap(async (_req, res) => {
    const db = requirePool(), current = await loadSnapshot(db);
    if (!current) { res.json({ snapshot: null, imagesConfigured: internalCatalogImagesConfigured() }); return; }
    const [context, facets, counts] = await Promise.all([loadCatalogContext(db), loadCatalogFacets(db, current.id),
      db.query<{ guid: string; count: string }>(`SELECT record->>'guid_group' AS guid,count(*) AS count
        FROM internal_catalog_products WHERE snapshot_id=$1 GROUP BY record->>'guid_group'`, [current.id])]);
    res.json({ snapshot: current, imagesConfigured: internalCatalogImagesConfigured(),
      groups: context.groups, groupCounts: counts.rows, facets, priceTypes: context.priceTypes });
  }));
  router.get("/products", wrap(async (req, res) => {
    const q = field(req, "q", 160), section = field(req, "section", 36),
      brand = field(req, "brand", 2000), page = field(req, "page", 7);
    if (q === null || section === null || brand === null || page === null ||
        (section && !GUID.test(section)) || (page && !/^[1-9]\d{0,6}$/.test(page)) ||
        normalizeSearch(q).split(" ").filter(Boolean).length > 8) { invalid(res); return; }
    const group = field(req, "group", 36), priceType = field(req, "priceType", 36),
      min = field(req, "min", 18), max = field(req, "max", 18), availability = field(req, "availability", 10),
      flag = field(req, "flag", 10), sort = field(req, "sort", 10), rawFilters = field(req, "filters", 12000);
    let properties: Record<string, string[]> = {};
    try {
      properties = JSON.parse(rawFilters || "{}");
      if (!properties || Array.isArray(properties) || typeof properties !== "object" || Object.keys(properties).length > 12 ||
          Object.entries(properties).some(([name, selected]) => !CATALOG_FACETS.includes(name as typeof CATALOG_FACETS[number]) ||
            !Array.isArray(selected) || !selected.length || selected.length > 20 ||
            selected.some(v => typeof v !== "string" || !v.trim() || v.length > 200))) throw new Error("filters");
    } catch { invalid(res); return; }
    const numeric = (x: string | null) => x === "" || (x !== null && /^\d{1,12}(?:\.\d{1,4})?$/.test(x));
    if (group === null || (group && !GUID.test(group)) || priceType === null || (priceType && !GUID.test(priceType)) ||
      !numeric(min) || !numeric(max) || (min && max && Number(min) > Number(max)) ||
      ((min || max || sort === "asc" || sort === "desc") && !priceType) ||
      availability === null || !["", "in", "zero", "unknown"].includes(availability) ||
      flag === null || !["", "new", "hit", "sale"].includes(flag) ||
      sort === null || !["", "name", "asc", "desc", "stock"].includes(sort) || rawFilters === null) { invalid(res); return; }
    const current = await snapshot(req, res);
    if (current === undefined) return;
    if (!current) { res.json({ snapshotId: null, total: 0, page: 1, pageSize: 24, items: [] }); return; }
    const context = await loadCatalogContext(requirePool());
    if (priceType && !context.priceTypes.some(x => x.guid === priceType.toLowerCase())) { invalid(res, "Тип цены не найден в выгрузке."); return; }
    const result = await searchProducts(requirePool(), current.id, { q, section, brand, page: Number(page || 1), pageSize: 24,
      group: group?.toLowerCase(), priceType: priceType?.toLowerCase(), properties, min: min ? Number(min) : undefined,
      max: max ? Number(max) : undefined, availability, flag, sort }, context);
    const guids = new Set(result.items.flatMap(item => [item.guid, ...item.variants.map(v => v.guid)]));
    const quality = await qualityForVisibleTargets([...guids].map(guid => ({ kind: "product", guid })));
    res.json({ ...result, items: result.items.map(item => ({ ...item, _onecQuality: quality.get("product:" + item.guid) ?? null,
      variants: item.variants.map(v => ({ ...v, _onecQuality: quality.get("product:" + v.guid) ?? null })) })) });
  }));
  router.get("/products/:guid", wrap(async (req, res) => {
    const guid = req.params.guid;
    if (!GUID.test(guid)) { invalid(res, "Некорректный идентификатор товара."); return; }
    const current = await snapshot(req, res);
    if (current === undefined) return;
    const product = current ? await loadProduct(requirePool(), current.id, guid) : null;
    if (!product) {
      res.status(404).json({ error: { code: "PRODUCT_NOT_FOUND", message: "Товар не найден в этой версии каталога." } });
      return;
    }
    const quality = await qualityForVisibleTargets([{ kind: "product", guid }]);
    let sourceValues: unknown[] = [];
    try {
      sourceValues = (await query(`SELECT r.file_key,r.row_index,r.record,b.imported_at
        FROM onec_manual_object_versions v JOIN onec_manual_records r
          ON r.batch_id=v.batch_id AND r.entity_kind=v.entity_kind AND r.entity_guid=v.entity_guid AND r.file_key=v.file_key
        JOIN onec_manual_batches b ON b.id=v.batch_id
        WHERE v.entity_kind='product' AND v.entity_guid=$1::uuid AND v.file_key IN ('prices','stocks')
        ORDER BY r.file_key,r.row_index`, [guid])).rows;
    } catch (error) { if ((error as { code?: string }).code !== "42P01") throw error; }
    const context = await loadCatalogContext(requirePool());
    const priceType = field(req, "priceType", 36);
    if (priceType === null || (priceType && !GUID.test(priceType))) { invalid(res); return; }
    const selectedPrice = req.query.priceType === undefined ?
      context.priceTypes.find(x => x.name === "РРЦ Тандор")?.guid || "" : priceType.toLowerCase();
    const variants = await loadProductVariants(requirePool(), current!.id, guid.toLowerCase(), context, selectedPrice);
    res.json({ snapshotId: current!.id, importedAt: current!.importedAt, product,
      variants, commerce: commerceFor(context, guid.toLowerCase()), _onecQuality: quality.get("product:" + guid) ?? null, sourceValues });
  }));
  router.get("/products/:guid/images/:fileGuid", wrap(async (req, res) => {
    const { guid, fileGuid } = req.params;
    if (!GUID.test(guid) || !GUID.test(fileGuid)) { invalid(res, "Некорректная ссылка на фотографию."); return; }
    const current = await snapshot(req, res);
    if (current === undefined) return;
    const product = current ? await loadProduct(requirePool(), current.id, guid) : null;
    const file = product?.files.find(item => item.guid === fileGuid.toLowerCase());
    const bytes = file ? await readInternalCatalogImage(file, requirePool(), current!.id) : null;
    if (!bytes) {
      res.status(404).json({ error: { code: "IMAGE_UNAVAILABLE", message: "Фотография пока недоступна." } });
      return;
    }
    res.set("X-Content-Type-Options", "nosniff");
    res.type("image/webp").send(bytes);
  }));
  return router;
}
