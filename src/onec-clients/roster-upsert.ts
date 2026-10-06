import type { PoolClient } from "pg";
import type { WholesaleEmployeeRecord, WholesaleEmployeeRoster } from "./employee-roster";

export type RosterUpsertCounts = {
  newCount: number;
  changedCount: number;
  unchangedCount: number;
};

type ExistingRosterRow = {
  guid_manager: string;
  name_manager: string;
  guid_post: string | null;
  post: string | null;
  condition: string | null;
  date_of_assumption: string | null;
  guid_work_schedule: string | null;
  work_schedule: string | null;
  decree: string | null;
  email: string | null;
  telephone: string | null;
  raw_json: Record<string, unknown>;
};

function hasRawKey(raw: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

function rosterRowEqual(existing: ExistingRosterRow, incoming: WholesaleEmployeeRecord): boolean {
  const resolve = <T>(key: keyof WholesaleEmployeeRecord & string, parsed: T | null, existingValue: T | null): T | null => {
    if (hasRawKey(incoming.raw, key)) {
      return parsed;
    }
    return existingValue;
  };

  const nextName = hasRawKey(incoming.raw, "name_manager") ? incoming.nameManager : existing.name_manager;
  const nextGuidPost = resolve("guidPost", incoming.guidPost, existing.guid_post);
  const nextPost = resolve("post", incoming.post, existing.post);
  const nextCondition = resolve("condition", incoming.condition, existing.condition);
  const nextDate = resolve("dateOfAssumption", incoming.dateOfAssumption, existing.date_of_assumption);
  const nextGuidSchedule = resolve("guidWorkSchedule", incoming.guidWorkSchedule, existing.guid_work_schedule);
  const nextSchedule = resolve("workSchedule", incoming.workSchedule, existing.work_schedule);
  const nextDecree = resolve("decree", incoming.decree, existing.decree);
  const nextEmail = resolve("email", incoming.email, existing.email);
  const nextTelephone = resolve("telephone", incoming.telephone, existing.telephone);

  return (
    existing.name_manager === nextName &&
    (existing.guid_post ?? null) === nextGuidPost &&
    (existing.post ?? null) === nextPost &&
    (existing.condition ?? null) === nextCondition &&
    (existing.date_of_assumption ?? null) === nextDate &&
    (existing.guid_work_schedule ?? null) === nextGuidSchedule &&
    (existing.work_schedule ?? null) === nextSchedule &&
    (existing.decree ?? null) === nextDecree &&
    (existing.email ?? null) === nextEmail &&
    (existing.telephone ?? null) === nextTelephone
  );
}

function resolveApplyValue<T>(
  raw: Record<string, unknown>,
  key: string,
  parsed: T | null,
  existing: T | null,
): T | null {
  if (hasRawKey(raw, key)) {
    return parsed;
  }
  return existing;
}

async function loadExistingRoster(client: PoolClient): Promise<Map<string, ExistingRosterRow>> {
  const result = await client.query<ExistingRosterRow>(
    `
      SELECT
        guid_manager::text,
        name_manager,
        guid_post::text,
        post,
        condition,
        date_of_assumption::text,
        guid_work_schedule::text,
        work_schedule,
        decree,
        email,
        telephone,
        raw_json
      FROM onec_wholesale_employee_roster
    `,
  );
  return new Map(result.rows.map((row) => [row.guid_manager.toLowerCase(), row]));
}

/**
 * Upsert wholesale employees from a regular update roster.
 * Employees absent from the file are retained; partial updates preserve omitted fields.
 */
export async function upsertWholesaleEmployeeRoster(
  client: PoolClient,
  roster: WholesaleEmployeeRoster,
): Promise<RosterUpsertCounts> {
  const existing = await loadExistingRoster(client);
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const record of roster.records) {
    const current = existing.get(record.guidManager.toLowerCase());
    if (!current) {
      newCount += 1;
    } else if (rosterRowEqual(current, record)) {
      unchangedCount += 1;
    } else {
      changedCount += 1;
    }

    const nameManager = resolveApplyValue(record.raw, "name_manager", record.nameManager, current?.name_manager ?? "");
    const guidPost = resolveApplyValue(record.raw, "guid_post", record.guidPost, current?.guid_post ?? null);
    const post = resolveApplyValue(record.raw, "post", record.post, current?.post ?? null);
    const condition = resolveApplyValue(record.raw, "condition", record.condition, current?.condition ?? null);
    const dateOfAssumption = resolveApplyValue(
      record.raw,
      "date_of_assumption",
      record.dateOfAssumption,
      current?.date_of_assumption ?? null,
    );
    const guidWorkSchedule = resolveApplyValue(
      record.raw,
      "guid_work_schedule",
      record.guidWorkSchedule,
      current?.guid_work_schedule ?? null,
    );
    const workSchedule = resolveApplyValue(
      record.raw,
      "work_schedule",
      record.workSchedule,
      current?.work_schedule ?? null,
    );
    const decree = resolveApplyValue(record.raw, "decree", record.decree, current?.decree ?? null);
    const email = resolveApplyValue(record.raw, "email", record.email, current?.email ?? null);
    const telephone = resolveApplyValue(record.raw, "telephone", record.telephone, current?.telephone ?? null);

    await client.query(
      `
        INSERT INTO onec_wholesale_employee_roster (
          guid_manager,
          name_manager,
          guid_post,
          post,
          condition,
          date_of_assumption,
          guid_work_schedule,
          work_schedule,
          decree,
          email,
          telephone,
          raw_json,
          imported_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3::uuid,
          $4,
          $5,
          $6::timestamptz,
          $7::uuid,
          $8,
          $9,
          $10,
          $11,
          $12::jsonb,
          NOW()
        )
        ON CONFLICT (guid_manager) DO UPDATE SET
          name_manager = EXCLUDED.name_manager,
          guid_post = EXCLUDED.guid_post,
          post = EXCLUDED.post,
          condition = EXCLUDED.condition,
          date_of_assumption = EXCLUDED.date_of_assumption,
          guid_work_schedule = EXCLUDED.guid_work_schedule,
          work_schedule = EXCLUDED.work_schedule,
          decree = EXCLUDED.decree,
          email = EXCLUDED.email,
          telephone = EXCLUDED.telephone,
          raw_json = EXCLUDED.raw_json,
          imported_at = NOW()
      `,
      [
        record.guidManager,
        nameManager,
        guidPost,
        post,
        condition,
        dateOfAssumption,
        guidWorkSchedule,
        workSchedule,
        decree,
        email,
        telephone,
        JSON.stringify(record.raw),
      ],
    );
  }

  await client.query(
    `
      INSERT INTO onec_wholesale_roster_state (id, source_sha256, employee_count, imported_at)
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        source_sha256 = EXCLUDED.source_sha256,
        employee_count = EXCLUDED.employee_count,
        imported_at = EXCLUDED.imported_at
    `,
    [roster.sourceSha256, roster.wholesaleCount],
  );

  return { newCount, changedCount, unchangedCount };
}
