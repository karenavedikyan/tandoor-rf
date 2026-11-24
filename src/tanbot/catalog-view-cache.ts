import type { Pool, PoolClient } from "pg";
import { loadCatalogBotView, type CatalogView } from "./catalog";

type Entry = { revision: string; view: CatalogView | null };
type Pending = { revision: string; result: Promise<{ view: CatalogView | null; stable: boolean }> };
type Cache = { entry?: Entry; pending?: Pending };
const caches = new WeakMap<Pool, Cache>();

async function sourceRevision(db: PoolClient): Promise<string | null> {
  // The code can ship before the additive migration, or before thumbnail storage
  // is available. Do not reference a missing table in the webhook transaction.
  const schema = await db.query<{ available: boolean }>(`
    SELECT to_regclass('public.tanbot_catalog_source_revisions') IS NOT NULL
       AND to_regclass('public.internal_catalog_thumbnails') IS NOT NULL AS available`);
  if (!schema.rows[0]?.available) return null;
  const result = await db.query<{ revision: string | null }>(`
    SELECT CASE WHEN count(*)=6 THEN string_agg(revision::text, ':' ORDER BY source_table) END AS revision
    FROM public.tanbot_catalog_source_revisions`);
  return result.rows[0]?.revision ?? null;
}

/** One shared, read-only projection per pool, not per chat or messenger. Only
 * call from the webhook's READ COMMITTED transaction, which never writes a
 * catalogue source. Reuse the caller's client so a cold load cannot exhaust
 * the pool by requesting a second connection from within the transaction. */
export async function loadCachedCatalogBotView(pool: Pool, db: PoolClient): Promise<CatalogView | null> {
  let cache = caches.get(pool);
  if (!cache) {
    cache = {};
    caches.set(pool, cache);
  }
  for (let attempt = 0; ; attempt++) {
    const revision = await sourceRevision(db);
    if (revision === null) {
      cache.entry = undefined;
      cache.pending = undefined;
      return loadCatalogBotView(db);
    }
    if (cache.entry?.revision === revision) return cache.entry.view;
    let pending = cache.pending;
    if (pending?.revision !== revision) {
      const result = (async () => {
        const view = await loadCatalogBotView(db);
        // Do not publish a mixed read if an import or photo write committed
        // between the projection's SQL statements.
        return { view, stable: await sourceRevision(db) === revision };
      })();
      pending = { revision, result };
      cache.pending = pending;
    }
    try {
      const { view, stable } = await pending.result;
      if (stable) {
        if (cache.pending === pending) cache.entry = { revision, view };
        return view;
      }
      // Retry a racing update once. Under sustained writes use the normal
      // uncached behavior, never publishing this unstable result.
      if (attempt === 1) return view;
    } finally {
      if (cache.pending === pending) cache.pending = undefined;
    }
  }
}
