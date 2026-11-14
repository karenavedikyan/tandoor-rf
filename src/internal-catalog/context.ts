import type { Pool, PoolClient } from "pg";
import { CATALOG_FACETS, buildCatalogContext, type SourceRow } from "./presentation";

/** Read-only projection of already imported evidence. No FTP, imports, writes or global data cache. */
export async function loadCatalogContext(db: Pool | PoolClient) {
  const rows = await db.query<SourceRow>(`SELECT r.file_key,r.record,b.imported_at
    FROM onec_manual_object_versions v JOIN onec_manual_records r
      ON r.batch_id=v.batch_id AND r.entity_kind=v.entity_kind AND r.entity_guid=v.entity_guid AND r.file_key=v.file_key
    JOIN onec_manual_batches b ON b.id=v.batch_id
    WHERE (v.entity_kind='product' AND v.file_key IN ('prices','stocks'))
       OR (v.entity_kind='group' AND v.file_key='groups')`);
  return buildCatalogContext(rows.rows);
}
export async function loadCatalogFacets(db: Pool, snapshotId: string) {
  const rows = await db.query<{ name: string; values: string[] }>(`SELECT name,array_agg(value ORDER BY value) AS values FROM (
    SELECT DISTINCT btrim(p->>'name') AS name,btrim(p->>'value') AS value
    FROM internal_catalog_products c CROSS JOIN LATERAL jsonb_array_elements(c.record->'properties') p
    WHERE snapshot_id=$1::uuid AND btrim(p->>'name')=ANY($2::text[])
      AND length(btrim(p->>'value')) BETWEEN 1 AND 200
    ) f GROUP BY name ORDER BY name`, [snapshotId, [...CATALOG_FACETS]]);
  return rows.rows;
}
