import type { PoolClient } from "pg";
import { REGULAR_UPDATE_JOB_KIND, REGULAR_UPDATE_JOB_SOURCE_NIGHTLY } from "../../onec-import/constants";

export const NIGHTLY_WINDOW_MISSED_CODE = "NIGHTLY_WINDOW_MISSED";
export const NIGHTLY_SCHEDULE_DISABLED_CODE = "NIGHTLY_SCHEDULE_DISABLED";

const nightlyJobResult = (errorCode: string, message: string) =>
  JSON.stringify({
    status: "ERROR",
    mode: "apply",
    errorCode,
    message,
  });

/** Finalize pending nightly jobs whose execution window has closed. Running jobs are not interrupted. */
export async function finalizeExpiredNightlyWindowJobs(client: PoolClient): Promise<void> {
  await client.query(
    `
      UPDATE onec_import_jobs AS jobs
      SET
        status = 'failed',
        finished_at = NOW(),
        error_code = $2,
        result = $3::jsonb
      WHERE jobs.kind = $1
        AND jobs.job_source = $4
        AND jobs.status = 'pending'
        AND jobs.nightly_window_deadline_at IS NOT NULL
        AND jobs.nightly_window_deadline_at <= NOW()
    `,
    [
      REGULAR_UPDATE_JOB_KIND,
      NIGHTLY_WINDOW_MISSED_CODE,
      nightlyJobResult(
        NIGHTLY_WINDOW_MISSED_CODE,
        "Ночное окно обмена с 1С уже закрыто; автоматический запуск пропущен.",
      ),
      REGULAR_UPDATE_JOB_SOURCE_NIGHTLY,
    ],
  );
}

/** When schedule is disabled, pending nightly jobs must not run on drain/kick. */
export async function finalizePendingNightlyWhenScheduleDisabled(client: PoolClient): Promise<void> {
  await client.query(
    `
      UPDATE onec_import_jobs AS jobs
      SET
        status = 'failed',
        finished_at = NOW(),
        error_code = $2,
        result = $3::jsonb
      WHERE jobs.kind = $1
        AND jobs.job_source = $4
        AND jobs.status = 'pending'
    `,
    [
      REGULAR_UPDATE_JOB_KIND,
      NIGHTLY_SCHEDULE_DISABLED_CODE,
      nightlyJobResult(
        NIGHTLY_SCHEDULE_DISABLED_CODE,
        "Ночной обмен с 1С отключён; ожидающее задание не будет выполнено автоматически.",
      ),
      REGULAR_UPDATE_JOB_SOURCE_NIGHTLY,
    ],
  );
}

export async function prepareRegularUpdateWorkerQueue(
  client: PoolClient,
  options: { nightlyScheduleEnabled: boolean },
): Promise<void> {
  await finalizeExpiredNightlyWindowJobs(client);
  if (!options.nightlyScheduleEnabled) {
    await finalizePendingNightlyWhenScheduleDisabled(client);
  }
}
