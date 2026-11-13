import type { PoolClient } from "pg";
import { parseHoldingRecord, parseLegalRecord, parseRetailRecord } from "../onec-exchange-v3/parse-records";
import { persistableLegalOtherFields } from "../onec-exchange-v3/persist-legal-other-fields";
import { addIssue, canonical, consensus, hash, type FileKey, type Prepared, type Row } from "./model";

/** Upsert non-access fields only. Access-bearing managers, parent links and composition are retained. */
export async function projectClients(db: PoolClient, p: Prepared): Promise<void> {
  for (const [file, table, idColumn, parse] of [
    ["holdings", "onec_v3_holdings", "guid_holding", parseHoldingRecord],
    ["clients", "onec_v3_legal_entities", "guid_client", parseLegalRecord],
    ["retail", "onec_v3_retail_outlets", "guid_store", parseRetailRecord],
  ] as const) {
    const sourceSha = hash(p.files[file].bytes);
    for (const [id, rows] of p.groups[file]) {
      const raw = consensus(rows), errors: string[] = [], parsed = parse(raw, errors);
      if (!parsed || errors.length) {
        addIssue(p, rows[0], "", "INVALID_PROJECTION", "Не все поля удалось применить к карточке. Исходные строки сохранены.");
        continue;
      }
      const record = parsed as unknown as Row;
      const previous = (await db.query(`SELECT * FROM ${table} WHERE ${idColumn}=$1::uuid`, [id])).rows[0];
      const activeManagers = (value: unknown) => Object.fromEntries(Object.entries((value ?? {}) as Row)
        .filter(([, v]) => v !== null && v !== undefined && v !== ""));
      if (canonical(activeManagers(previous?.managers)) !== canonical(activeManagers(record.managers)) ||
          (file !== "holdings" && (previous?.guid_holding ?? null) !== (record.guidHolding ?? null))) {
        addIssue(p, rows[0], "managers/guid_holding", "ACCESS_ASSIGNMENT_RETAINED",
          "Исходные назначения или связь отличаются от действующих. Права доступа сохранены без автоматического переназначения.",
          rows.map(row => row.index));
      }
      if (file === "holdings") {
        const saved = (await db.query(`SELECT member_kind,member_guid::text,name_retail
          FROM onec_v3_holding_composition WHERE guid_holding=$1::uuid ORDER BY member_kind,member_guid`, [id])).rows;
        const source = [
          ...((record.legalEntities ?? []) as Array<{ guidRetail: string; nameRetail: string }>).map(m =>
            ({ member_kind: "legal", member_guid: m.guidRetail, name_retail: m.nameRetail })),
          ...((record.retailOutlets ?? []) as Array<{ guidRetail: string; nameRetail: string }>).map(m =>
            ({ member_kind: "retail", member_guid: m.guidRetail, name_retail: m.nameRetail })),
        ].sort((a, b) => a.member_kind.localeCompare(b.member_kind) || a.member_guid.localeCompare(b.member_guid));
        if (canonical(saved) !== canonical(source)) addIssue(p, rows[0], "legal_entities/retail_outlets",
          "COMPOSITION_RETAINED", "Исходный состав отличается от действующего. Связи доступа сохранены; проверьте состав в 1С.");
      }
      // Fields whose source values disagree are left unchanged, while raw variants remain visible.
      const fields: Array<[string, string, unknown]> = file === "holdings" ? [
        ["name_holding", "name_holding", record.nameHolding], ["type_category", "type_category", record.typeCategory],
        ["retail_chain", "retail_chain", record.retailChain], ["holding_group", "holding_group", record.holdingGroup],
      ] : file === "clients" ? [
        ["name_client", "name_client", record.nameClient], ["inn", "inn", record.inn], ["kpp", "kpp", record.kpp],
        ["type_category", "type_category", record.typeCategory], ["address", "address", record.address],
        ["telephone", "telephone", record.telephone], ["Discount", "discount", record.discount],
        ["DiscountAmount", "discount_amount", record.discountAmount], ["markups", "markups", record.markups],
        ["other", "other_fields", persistableLegalOtherFields(record.otherFields as Row, sourceSha)],
      ] : [
        ["warehouse", "warehouse", record.warehouse], ["closed", "closed", record.closed],
        ["type_category", "type_category", record.typeCategory], ["address", "address", record.address],
        ["information_loading", "information_loading", record.informationLoading],
        ["contact_information", "contact_information", record.contactInformation],
        ["LPR_information", "lpr_information", record.lprInformation],
        ["additional_information", "additional_information", record.additionalInformation],
      ];
      const values: unknown[] = [id];
      const columns: string[] = [idColumn], expressions = ["$1::uuid"], updates: string[] = [];
      for (const [source, column, value] of fields) {
        if (!(source in raw)) continue;
        columns.push(column);
        const json = value !== null && typeof value === "object";
        values.push(json ? JSON.stringify(value) : value);
        expressions.push(`$${values.length}${json ? "::jsonb" : ""}`);
        updates.push(`${column}=EXCLUDED.${column}`);
      }
      // The name column is mandatory for a new holding/legal. No invented display name.
      if (!previous && file !== "retail" && !columns.includes(file === "holdings" ? "name_holding" : "name_client")) {
        addIssue(p, rows[0], "name", "INVALID_PROJECTION", "Конфликт названия: исходные варианты сохранены без выбора одного из них.");
        continue;
      }
      columns.push("last_source_sha256"); values.push(sourceSha); expressions.push(`$${values.length}`);
      updates.push("last_source_sha256=EXCLUDED.last_source_sha256", "last_imported_at=NOW()");
      await db.query(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${expressions.join(",")})
        ON CONFLICT(${idColumn}) DO UPDATE SET ${updates.join(",")}`, values);
    }
  }
}

/** Employee source is refreshed without mutating user profiles, team memberships or identity bindings. */
export async function projectEmployees(db: PoolClient, p: Prepared): Promise<void> {
  for (const [id, rows] of p.groups.employees) {
    const r = consensus(rows);
    if (typeof r.name_manager !== "string") continue;
    await db.query(`INSERT INTO onec_wholesale_employee_roster(guid_manager,name_manager,raw_json,imported_at)
      VALUES($1::uuid,$2,$3::jsonb,NOW())
      ON CONFLICT(guid_manager) DO UPDATE SET name_manager=EXCLUDED.name_manager,
      raw_json=EXCLUDED.raw_json,imported_at=NOW()`,
    [id, r.name_manager, JSON.stringify(r)]);
  }
}

export async function persistEvidence(db: PoolClient, p: Prepared, batch: string): Promise<void> {
  for (const file of Object.keys(p.files) as FileKey[]) {
    const s = p.files[file];
    await db.query(`INSERT INTO onec_manual_files(batch_id,file_key,source_name,sha256,source_bytes,row_count)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [batch, file, s.sourceName, hash(s.bytes), s.bytes, p.counts[file]]);
  }
  for (let start = 0; start < p.records.length; start += 500) {
    const records = p.records.slice(start, start + 500);
    await db.query(`INSERT INTO onec_manual_records(batch_id,file_key,row_index,entity_kind,entity_guid,record)
      SELECT $1::uuid,x.file,x.index,x.kind,x.guid::uuid,COALESCE(x.record,'null'::jsonb) FROM jsonb_to_recordset($2::jsonb)
      AS x(file text,index integer,kind text,guid text,record jsonb) ON CONFLICT DO NOTHING`,
    [batch, JSON.stringify(records.map(row => ({ ...row, record: row.raw })))]);
  }
  // Object pointers are updated only for objects observed and checked in this bundle.
  const targets = new Map<string, { kind: string; guid: string; file: string }>();
  for (const row of p.records) if (row.guid) targets.set(row.kind + ":" + row.guid + ":" + row.file,
    { kind: row.kind, guid: row.guid, file: row.file });
  await db.query(`INSERT INTO onec_manual_object_versions(entity_kind,entity_guid,file_key,batch_id)
    SELECT x.kind,x.guid::uuid,x.file,$1::uuid FROM jsonb_to_recordset($2::jsonb) AS x(kind text,guid text,file text)
    ON CONFLICT(entity_kind,entity_guid,file_key) DO UPDATE SET batch_id=EXCLUDED.batch_id`,
  [batch, JSON.stringify([...targets.values()])]);
  for (let start = 0; start < p.issues.length; start += 500) {
    await db.query(`INSERT INTO onec_manual_issues(batch_id,issue_key,entity_kind,entity_guid,file_key,field_name,code,message,row_indices)
      SELECT $1::uuid,x.key,x.kind,x.guid::uuid,x.file,x.field,x.code,x.message,x.indices
      FROM jsonb_to_recordset($2::jsonb)
      AS x(key text,kind text,guid text,file text,field text,code text,message text,indices jsonb)
      ON CONFLICT DO NOTHING`, [batch, JSON.stringify(p.issues.slice(start, start + 500))]);
  }
}
