import express from "express";
import { requirePool } from "../db/pool";
import { internalCatalogAccess } from "./access";
import { GUID, normalizeSearch } from "./model";
import { loadProduct, loadSnapshot, searchProducts } from "./repository";
import { internalCatalogImagesConfigured, readInternalCatalogImage } from "./images";

export function createInternalCatalogRouter(): express.Router {
  const router = express.Router();
  router.use(...internalCatalogAccess);
  const wrap = (handler: (req: express.Request, res: express.Response) => Promise<void>): express.RequestHandler =>
    (req, res, next) => { void handler(req, res).catch(next); };
  function invalid(res: express.Response, message = "Проверьте параметры поиска.") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message } });
  }
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
    res.json({ snapshot: await loadSnapshot(requirePool()), imagesConfigured: internalCatalogImagesConfigured() });
  }));
  router.get("/products", wrap(async (req, res) => {
    const q = field(req, "q", 160), section = field(req, "section", 36),
      brand = field(req, "brand", 2000), page = field(req, "page", 7);
    if (q === null || section === null || brand === null || page === null ||
        (section && !GUID.test(section)) || (page && !/^[1-9]\d{0,6}$/.test(page)) ||
        normalizeSearch(q).split(" ").filter(Boolean).length > 8) { invalid(res); return; }
    const current = await snapshot(req, res);
    if (current === undefined) return;
    if (!current) { res.json({ snapshotId: null, total: 0, page: 1, pageSize: 24, items: [] }); return; }
    res.json(await searchProducts(requirePool(), current.id, { q, section, brand, page: Number(page || 1), pageSize: 24 }));
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
    res.json({ snapshotId: current!.id, importedAt: current!.importedAt, product });
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
