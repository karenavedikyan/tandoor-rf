import { getDatabaseUrl } from "../config";
import { createImportPool } from "../onec-clients/apply";
import { tryAcquireImportLock, releaseImportLock } from "../onec-clients/import-lock";
import { parseRegularUpdateCliArgs } from "../onec-regular-update/cli-args";
import type { RegularUpdateResult } from "../onec-regular-update/types";
import { prepareManualBundle, type ManualFiles } from "./model";
import { readManualFiles, type ManualReader } from "./read";
import { projectClients, projectEmployees, persistEvidence } from "./project";
import { prepareSales, projectSales } from "./sales";
import { projectCatalog } from "./catalog";
import { checkOperatorImportJobRunnable } from "../onec-clients/import-job-guard";
import type { PoolClient } from "pg";

async function finishOperatorJob(db: PoolClient, jobId: string | undefined, outcome: RegularUpdateResult) {
  if (!jobId) return;
  // Commit the result with its projection, including NO_CHANGES and A→B→A.
  // A crash after COMMIT must not depend on the first owner of a reused batch.
  await db.query(`UPDATE onec_import_jobs SET status='success',finished_at=NOW(),
    result=$2::jsonb,error_code=NULL WHERE id=$1::uuid AND status='running'`,
  [jobId, JSON.stringify(outcome)]);
}

export type ManualUpdateOptions = {
  env?: NodeJS.ProcessEnv; argv?: string[]; directory?: string;
  manualFiles?: ManualFiles; manualReader?: ManualReader; operatorImportJobId?: string;
  /** Fault injection only on isolated test DB. Never exposed by HTTP. */
  beforeManualCommit?: () => Promise<void>;
};
export async function runManualUpdate(options: ManualUpdateOptions): Promise<RegularUpdateResult> {
  const env = options.env ?? process.env, started = Date.now(), startedAt = new Date(started).toISOString();
  const cli = parseRegularUpdateCliArgs(options.argv ?? []);
  const mode = cli.ok ? cli.options.mode : "dry_run";
  const result = (value: Partial<RegularUpdateResult> & { status: RegularUpdateResult["status"]; message: string }): RegularUpdateResult => ({
    mode, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - started, ...value,
  });
  if (!cli.ok) return result({ status: "REJECTED_BY_CHECKS", errorCode: cli.code, message: "Проверьте параметры запуска." });
  let p: ReturnType<typeof prepareManualBundle>, sales: ReturnType<typeof prepareSales>;
  try {
    p = prepareManualBundle(options.manualFiles ?? await readManualFiles({
      env, directory: options.directory, reader: options.manualReader,
    }));
    sales = prepareSales(p);
  } catch (error) {
    const code = error instanceof Error ? error.message.split(":")[0] : "SOURCE_UNREADABLE";
    return result({ status: "ERROR", errorCode: code, stage: code === "CONFIG_INVALID" ? "config" : "file_read",
      message: "Не обновлено: не удалось прочитать полный стабильный комплект 1С. Прежние данные сохранены." });
  }
  const common = {
    verificationFingerprint: p.fingerprint, applyPermitted: true, releaseConsistencyConfirmed: false,
    clientsReadCount: p.counts.clients, rosterReadCount: p.counts.employees,
    counts: { clientsProcessed: p.counts.clients, outletsProcessed: p.counts.retail, employeesProcessed: p.counts.employees },
    manualSummary: { files: p.counts, issueCount: p.issues.length, batchId: null as string | null },
  };
  if (mode === "dry_run") return result({ ...common, status: "SUCCESS",
    message: `Проверены 12 файлов. Замечаний: ${p.issues.length}. Согласованность момента выгрузки 1С без manifest не подтверждена.` });
  if (cli.options.expectedFingerprint !== p.fingerprint)
    return result({ ...common, status: "REJECTED_BY_CHECKS", applyPermitted: false,
      errorCode: "VERIFICATION_FINGERPRINT_MISMATCH", message: "Комплект изменился после проверки. Прежние данные сохранены." });
  const url = env.DATABASE_URL ?? getDatabaseUrl();
  if (!url) return result({ status: "ERROR", errorCode: "DATABASE_ERROR", message: "База данных недоступна." });
  const pool = createImportPool(url);
  let db;
  try { db = await pool.connect(); } catch {
    await pool.end();
    return result({ status: "ERROR", errorCode: "DATABASE_ERROR", message: "База недоступна. Обновление не началось." });
  }
  let locked = false, committing = false;
  try {
    locked = await tryAcquireImportLock(db);
    if (!locked) return result({ ...common, status: "REJECTED_BY_CHECKS", errorCode: "IMPORT_LOCKED",
      message: "Другое обновление выполняется. Прежние данные сохранены." });
    await db.query("BEGIN");
    await db.query("SET LOCAL statement_timeout='120s'");
    if (options.operatorImportJobId) {
      await db.query("SELECT id FROM onec_import_jobs WHERE id=$1::uuid FOR UPDATE", [options.operatorImportJobId]);
      if (!(await checkOperatorImportJobRunnable(db, options.operatorImportJobId)).runnable) throw new Error("JOB_NOT_RUNNABLE");
    }
    const blocked = await db.query(`SELECT apply_blocked FROM onec_exchange_state WHERE id=1
      UNION ALL SELECT apply_blocked FROM onec_v3_exchange_state WHERE id=1`);
    if (blocked.rows.some(row => row.apply_blocked)) throw new Error("APPLY_BLOCKED");
    const active = await db.query<{ id: string; fingerprint: string; issue_count: number }>(`SELECT b.id,b.fingerprint,b.issue_count
      FROM onec_manual_state s JOIN onec_manual_batches b ON b.id=s.batch_id WHERE s.id=1 FOR UPDATE OF s`);
    if (active.rows[0]?.fingerprint === p.fingerprint) {
      await db.query("UPDATE onec_manual_state SET checked_at=NOW() WHERE id=1");
      const outcome = result({ ...common, status: "NO_CHANGES", exportBatchId: active.rows[0].id,
        manualSummary: { ...common.manualSummary, batchId: active.rows[0].id, issueCount: active.rows[0].issue_count },
        message: `Нет изменений. Замечаний: ${active.rows[0].issue_count}.` });
      await finishOperatorJob(db, options.operatorImportJobId, outcome);
      committing = true; await db.query("COMMIT"); committing = false;
      return outcome;
    }
    // A previously seen bundle can become active again. Projection + diagnostics are recomputed.
    const batch = (await db.query<{ id: string }>(`INSERT INTO onec_manual_batches(fingerprint,operator_job_id,counts)
      VALUES($1,$2::uuid,$3::jsonb) ON CONFLICT(fingerprint) DO UPDATE SET imported_at=NOW()
      RETURNING id`, [p.fingerprint, options.operatorImportJobId ?? null, JSON.stringify(p.counts)])).rows[0].id;
    await projectClients(db, p);
    await projectEmployees(db, p);
    await projectSales(db, p, sales);
    await projectCatalog(db, p);
    // Recomputed issues may differ on A→B→A because retained access projections are not the raw source.
    await db.query("DELETE FROM onec_manual_issues WHERE batch_id=$1", [batch]);
    await persistEvidence(db, p, batch);
    await db.query("UPDATE onec_manual_batches SET issue_count=$2 WHERE id=$1", [batch, p.issues.length]);
    await db.query("UPDATE onec_manual_state SET batch_id=$1,checked_at=NOW() WHERE id=1", [batch]);
    await db.query(`UPDATE onec_v3_exchange_state SET last_bundle_fingerprint=$1,last_successful_apply_at=NOW(),
      last_attempt_at=NOW(),updated_at=NOW() WHERE id=1`, [p.fingerprint]);
    if (options.beforeManualCommit) {
      if (env.NODE_ENV !== "test" || env.TEST_DATABASE_URL !== url) throw new Error("TEST_HOOK_FORBIDDEN");
      await options.beforeManualCommit();
    }
    const outcome = result({ ...common, status: "SUCCESS", exportBatchId: batch,
      manualSummary: { ...common.manualSummary, batchId: batch, issueCount: p.issues.length },
      message: p.issues.length ? `Обновлено с замечаниями. Требуют проверки: ${p.issues.length}.` : "Обновлено. Замечаний не обнаружено." });
    await finishOperatorJob(db, options.operatorImportJobId, outcome);
    committing = true; await db.query("COMMIT"); committing = false;
    return outcome;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    if (error instanceof Error && error.message === "APPLY_BLOCKED")
      return result({ ...common, status: "REJECTED_BY_CHECKS", applyPermitted: false, errorCode: "APPLY_BLOCKED",
        message: "Обновление заблокировано до проверки предыдущей операции. Прежние данные сохранены." });
    if (committing) {
      const recovery = createImportPool(url);
      try { await recovery.query(`UPDATE onec_v3_exchange_state SET apply_blocked=TRUE,
        apply_blocked_reason='COMMIT_UNCERTAIN',updated_at=NOW() WHERE id=1`); } catch { /* operator must inspect DB availability */ }
      finally { await recovery.end(); }
    }
    return result({ ...common, status: "ERROR", applyPermitted: false,
      errorCode: committing ? "COMMIT_UNCERTAIN" : "DATABASE_ERROR", stage: "apply",
      message: committing ? "Результат сохранения уточняется. Не запускайте повтор до проверки состояния."
        : "Не обновлено: техническая ошибка. Прежняя активная версия и её замечания сохранены." });
  } finally {
    if (locked) await releaseImportLock(db).catch(() => {});
    db.release(); await pool.end();
  }
}
