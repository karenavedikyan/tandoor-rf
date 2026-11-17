import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { Pool } from "pg";
import { resolveMigrationsDir, runMigrations } from "../../src/db/migrate-runner";
import { createTestUser, getIntegrationDatabaseUrl, resetDatabase, setIntegrationEnv } from "../helpers/test-db";

it("086 upgrades a populated old schema without changing identities, bindings, history or queued legacy targets", async () => {
  const db = getIntegrationDatabaseUrl(); setIntegrationEnv(db); await resetDatabase(db);
  const p = new Pool({ connectionString:db,max:1 });
  try {
    await p.query("CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const dir = resolveMigrationsDir();
    for (const name of (await fs.readdir(dir)).filter(n => n.endsWith(".sql") && n < "086_").sort()) {
      await p.query(await fs.readFile(path.join(dir,name),"utf8"));
      await p.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [name]);
    }
    const user = (await createTestUser({ databaseUrl:db,email:"schema-preservation@test.local",
      password:"SyntheticPass123!",fullName:"Сотрудник",phone:"+79000000001" })).id;
    for (const channel of ["max","telegram"]) {
      await p.query(`INSERT INTO tanbot_${channel}_accounts
        (user_id,${channel}_user_id,${channel}_chat_id,notifications_enabled) VALUES ($1,99001,99001,FALSE)`, [user]);
    }
    const party = (await p.query(`INSERT INTO tt_parties(kind,user_id,display_name,phone_e164)
      VALUES ('user',$1,'Сотрудник','+79000000001') RETURNING id`, [user])).rows[0].id;
    await p.query(`INSERT INTO tt_transfers(id,public_code,item_title,status,creator_party_id,holder_party_id,pending_party_id)
      VALUES ('UPGRADE-1','UPGRADE-1','Предмет','waiting',$1,$1,$1)`, [party]);
    await p.query(`INSERT INTO tt_automatic_receipt_codes
      (id,transfer_id,handoff_version,pending_party_id,channel,messenger_user_id,messenger_chat_id)
      VALUES (gen_random_uuid(),'UPGRADE-1',1,$1,'max','99001','99001')`, [party]);
    await p.query(`INSERT INTO tanbot_notification_outbox(idempotency_key,user_id,channel,event_type,payload)
      VALUES ('legacy-upgrade',$1,'max','tan_tracker.assignment','{}')`, [user]);
    await p.query(`INSERT INTO tt_audit_log(transfer_id,actor_user_id,acting_party_id,action,detail)
      VALUES ('UPGRADE-1',$1,$2,'synthetic_upgrade_test','{}')`, [user,party]);
    const tables = ["users","tt_parties","tt_transfers","tt_audit_log","tanbot_max_accounts","tanbot_telegram_accounts",
      "tt_automatic_receipt_codes","tanbot_notification_outbox"];
    const snapshots = new Map<string,Record<string,unknown>[]>();
    for (const table of tables) snapshots.set(table,(await p.query(`SELECT * FROM ${table}`)).rows);
    assert.deepEqual(await runMigrations({ databaseUrl:db }),["086_messenger_additional_accounts.sql"]);
    assert.deepEqual(await runMigrations({ databaseUrl:db }),[]);
    for (const table of tables) {
      const before = snapshots.get(table)!;
      const after = (await p.query(`SELECT * FROM ${table}`)).rows.map(row =>
        Object.fromEntries(Object.keys(before[0]!).map(key => [key,row[key]])));
      assert.deepEqual(after,before,`${table}: every pre-upgrade field is preserved`);
    }
    for (const channel of ["max","telegram"]) {
      const rows = (await p.query(`SELECT * FROM tanbot_${channel}_all_accounts`)).rows;
      assert.equal(rows.length,1); assert.equal(rows[0].is_primary,true); assert.equal(rows[0].phone_e164,null);
      assert.equal((await p.query(`SELECT 1 FROM tanbot_${channel}_additional_accounts`)).rowCount,0);
    }
    assert.equal((await p.query("SELECT target_messenger_user_id FROM tanbot_notification_outbox")).rows[0].target_messenger_user_id,null);
    assert.equal((await p.query("SELECT delivery_epoch FROM tt_automatic_receipt_codes")).rows[0].delivery_epoch,null);
    assert.equal((await p.query("SELECT 1 FROM tt_automatic_receipt_account_deliveries")).rowCount,0);
  } finally { await p.end(); }
});
