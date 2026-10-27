import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { runExchangeV3RegularUpdate } from "../../src/onec-exchange-v3/run-update";
import { assertTestDatabaseUrl, createTestUser, prepareDatabase, setIntegrationEnv } from "./test-db";
import { linkUserToEmployee } from "./access-db-fixtures";
import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "./onec-clients-employee-roster-fixtures";

export const QA_PASSWORD = "LocalTestOnly-Assignments2026!";
export const EMP = {
  manager: "22222222-2222-4222-8222-222222222222",
  manager2: "33333333-3333-4333-8333-333333333333",
  assistant: "99999999-9999-4999-8999-999999999999",
  assistant2: "99999999-9999-4999-8999-999999999998",
  director: "55555555-5555-4555-8555-555555555555",
};
export const LEGAL = "b2000000-0000-4000-8000-000000000001";
export const FOREIGN_LEGAL = "b2000000-0000-4000-8000-000000000004";
export async function seedAssignmentQa(databaseUrl: string, origin = "http://127.0.0.1:3000") {
  assertTestDatabaseUrl(databaseUrl, "assistant assignment QA seed");
  setIntegrationEnv(databaseUrl, origin);
  await prepareDatabase(databaseUrl);
  const users: Record<string, { id: string; email: string; role: string }> = {};
  const names: Record<string, string> = { manager: "Тест: Алексей Морозов", manager2: "Тест: Елена Орлова",
    assistant: "Тест: Анна Белова", assistant2: "Тест: Павел Черняк", coordinator: "Тест: Координатор",
    director: "Тест: Директор", admin: "Тест: Администратор", rop: "Тест: РОП" };
  for (const key of Object.keys(names)) {
    const role = key === "manager2" ? "manager" : key === "assistant2" ? "assistant" : key;
    const email = `assignment-${key}@example.test`;
    const user = await createTestUser({ databaseUrl, email, password: QA_PASSWORD, fullName: names[key]!, role });
    users[key] = { id: user.id, email, role };
  }
  for (const [key, employeeId] of Object.entries(EMP)) {
    await linkUserToEmployee({ databaseUrl, userId: users[key]!.id, employeeId, confirmedByUserId: users.admin!.id });
  }
  const dir = path.join(process.cwd(), "test/fixtures/onec-exchange-v3");
  const bytes = {
    holdingsBytes: fs.readFileSync(path.join(dir, "all_holding.json")),
    clientsBytes: fs.readFileSync(path.join(dir, "all_clients.json")),
    retailBytes: fs.readFileSync(path.join(dir, "all_retail.json")),
    employeesBytes: buildEmployeeRosterBytes(Object.entries(EMP).map(([key, id]) => buildEmployeeRosterEntry(id, { name_manager: names[key] }))),
  };
  const dry = await runExchangeV3RegularUpdate({ env: { ...process.env, DATABASE_URL: databaseUrl }, argv: ["--dry-run"], ...bytes });
  if (dry.status !== "SUCCESS") throw Error("QA import dry run failed");
  const applied = await runExchangeV3RegularUpdate({ env: { ...process.env, DATABASE_URL: databaseUrl },
    argv: ["--apply", "--expected-fingerprint", dry.verificationFingerprint!], ...bytes });
  if (applied.status !== "SUCCESS") throw Error("QA import failed");
  const pool = new Pool({ connectionString: databaseUrl });
  for (let i = 1; i <= 64; i++) {
    const id = `d2000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const name = `Тест: Партнёр ${String(i).padStart(2, "0")}`;
    const city = ["Краснодар", "Ростов-на-Дону", "Сочи"][i % 3]!;
    const fields = { Оптовик_КрайГород: city, Оптовик_ОсновнойДоговор: `ТЕСТ-${i}/26` };
    await pool.query(`INSERT INTO onec_clients(guid_client,name_client,guid_manager,name_manager,source_sha256,manager_roster_state)
      VALUES($1,$2,$3,$4,$5,'in_wholesale_roster')`, [id, name, EMP.manager, names.manager, "0".repeat(64)]);
    await pool.query(`INSERT INTO onec_v3_legal_entities(guid_client,name_client,inn,type_category,managers,other_fields)
      VALUES($1,$2,$3,$4,$5,$6)`, [id, name, String(2300000000 + i), JSON.stringify({ nameCategory: i % 2 ? "Опт" : "Розница" }),
      JSON.stringify({ guidManager: EMP.manager, nameManager: names.manager }), JSON.stringify(fields)]);
    if (i % 4) await pool.query(`INSERT INTO onec_v3_legal_sales_lines(legal_guid,sale_month,product_type,
      quantity,income,manual_discount,automatic_discount,total_discount,cost_price,additional_expenses,gross_profit,profitability,source_sha256)
      VALUES($1,'2026-09-01','Тестовый товар',10,$2,0,0,0,0,0,0,0,$3)`, [id, i * 12500, "0".repeat(64)]);
  }
  await pool.end();
  return users;
}
