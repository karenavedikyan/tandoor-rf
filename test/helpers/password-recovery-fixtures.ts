import { Pool } from "pg";
import { prepareDatabase, getIntegrationDatabaseUrl, setIntegrationEnv } from "./test-db";
import { resetPoolForTests } from "../../src/db/pool";
import { hashPassword } from "../../src/auth/password";
import { createSession } from "../../src/auth/session";
import type { RecoveryDelivery } from "../../src/access/password-reset-service";

export const RECOVERY_ORIGIN = "http://127.0.0.1:3000";
export const RECOVERY_PASSWORD = "Synthetic-current-pass-123!";
export const RECOVERY_NEW_PASSWORD = "Synthetic-permanent-pass-456!";
export const RECOVERY_ADMIN = "admin@example.test", RECOVERY_EMPLOYEE = "employee@example.test";
export type RecoveryMessage = Parameters<RecoveryDelivery>[0];
export async function prepareRecoveryTest() {
  const db = getIntegrationDatabaseUrl();
  setIntegrationEnv(db, RECOVERY_ORIGIN);
  await prepareDatabase(db);
  await resetPoolForTests();
  return { pool: new Pool({ connectionString: db, ssl: false }), hash: await hashPassword(RECOVERY_PASSWORD) };
}
export async function seedRecoveryTest(pool: Pool, hash: string) {
  await pool.query("TRUNCATE users,login_rate_limits CASCADE");
  const r = await pool.query(
    `INSERT INTO users(email,full_name,password_hash,role,status)
     VALUES($1,'Тестовый Администратор',$3,'admin','active'),($2,'Тестовый Сотрудник',$3,'manager','active')
     RETURNING id,email`, [RECOVERY_ADMIN, RECOVERY_EMPLOYEE, hash],
  );
  const adminId: string = r.rows.find(u => u.email === RECOVERY_ADMIN).id;
  const employeeId: string = r.rows.find(u => u.email === RECOVERY_EMPLOYEE).id;
  await pool.query(
    `INSERT INTO tanbot_telegram_accounts(user_id,telegram_user_id,telegram_chat_id)
     VALUES($1,11001,11001),($2,22002,22002);
     `, [adminId, employeeId],
  );
  await pool.query(
    "INSERT INTO tanbot_max_accounts(user_id,max_user_id,max_chat_id) VALUES($1,33003,33003),($2,44004,44004)",
    [adminId, employeeId],
  );
  return { adminId, employeeId, adminSession: await createSession(adminId), employeeSession: await createSession(employeeId) };
}
export const codeFromMessage = (message: RecoveryMessage): string => {
  const code = /Временный код: (\d{8})/.exec(message.text)?.[1];
  if (!code) throw new Error("Synthetic bot message did not contain a code");
  return code;
};
