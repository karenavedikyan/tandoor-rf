#!/usr/bin/env node
/**
 * Stable Tan-Tracker fixtures for tt56 user-test seed (idempotent, prefix TT56-S-).
 */
import fs from "node:fs";
import path from "node:path";
import { ensurePartyForUserOnWrite } from "../../dist/tan-tracker/repository.js";

export const FIXTURE = {
  EMP_A: "e1111111-1111-4111-8111-111111111111",
  EMP_B: "e2222222-2222-4222-8222-222222222222",
  EMP_ROP: "e3333333-3333-4333-8333-333333333333",
  TEAM: "44444444-4444-4444-8444-444444444444",
  PARTY_EXT_RELAY: "f3333333-3333-4333-8333-333333333333",
  PARTY_EXT_FINAL: "f4444444-4444-4444-8444-444444444444",
  TRANSFER_WAIT_AB: "TT56-S-WAIT-AB",
  TRANSFER_RELAY: "TT56-S-RELAY-01",
  TRANSFER_ACTIVE_A: "TT56-S-ACTIVE-A",
  TRANSFER_DONE: "TT56-S-DONE-01",
};

/** Fixture attachments seeded with stable storage keys (see seedAttachment). */
export const FIXTURE_ATTACHMENT_SPECS = [
  { storageKey: "tt56-seed-active-a.txt", transferId: FIXTURE.TRANSFER_ACTIVE_A, name: "seed-active-a.txt" },
  { storageKey: "tt56-seed-wait-ab.txt", transferId: FIXTURE.TRANSFER_WAIT_AB, name: "seed-wait-ab.txt" },
];

/**
 * Legacy upgrade: fixture transfer already exists but attachment was removed before provenance existed.
 * Record tombstone so seed does not recreate the file/row.
 */
export async function markLegacyDeletedFixtureAttachments(client) {
  for (const spec of FIXTURE_ATTACHMENT_SPECS) {
    const transfer = await client.query(`SELECT 1 FROM tt_transfers WHERE id = $1 LIMIT 1`, [spec.transferId]);
    if (!transfer.rowCount) continue;

    const attachment = await client.query(
      `SELECT 1 FROM tt_transfer_attachments WHERE storage_key = $1 LIMIT 1`,
      [spec.storageKey],
    );
    if (attachment.rowCount) continue;

    await client.query(
      `INSERT INTO tt56_user_test_fixture_provenance (storage_key) VALUES ($1) ON CONFLICT DO NOTHING`,
      [spec.storageKey],
    );
  }
}

async function upsertEmployeeLink(client, userId, employeeId, adminId) {
  const updated = await client.query(
    `UPDATE user_onec_employee_links
     SET employee_id = $2::uuid, basis = 'tt56 user test seed', confirmed_by_user_id = $3::uuid
     WHERE user_id = $1::uuid AND revoked_at IS NULL`,
    [userId, employeeId, adminId],
  );
  if ((updated.rowCount ?? 0) === 0) {
    await client.query(
      `INSERT INTO user_onec_employee_links (user_id, employee_id, basis, confirmed_by_user_id)
       VALUES ($1::uuid, $2::uuid, 'tt56 user test seed', $3::uuid)`,
      [userId, employeeId, adminId],
    );
  }
}

async function ensureExternalParty(client, id, name, phone, createdBy) {
  await client.query(
    `INSERT INTO tt_parties (id, kind, display_name, phone_e164, created_by_user_id)
     VALUES ($1::uuid, 'external', $2, $3, $4::uuid)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, phone_e164 = EXCLUDED.phone_e164`,
    [id, name, phone, createdBy],
  );
}

async function seedTransfer(client, row) {
  const hv = row.handoffVersion ?? 1;
  await client.query(
    `INSERT INTO tt_transfers (
       id, public_code, item_title, qty_label, comment_text, status,
       creator_party_id, holder_party_id, pending_party_id, final_recipient_party_id,
       due_at, handoff_version, row_version, completed_at
     ) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12)
     ON CONFLICT (id) DO NOTHING`,
    [
      row.id,
      row.itemTitle,
      row.qty ?? null,
      row.comment ?? null,
      row.status,
      row.creatorPartyId,
      row.holderPartyId,
      row.pendingPartyId ?? null,
      row.finalPartyId ?? null,
      row.dueAt ?? null,
      hv,
      row.status === "completed" ? new Date() : null,
    ],
  );
  const exists = await client.query(`SELECT 1 FROM tt_transfers WHERE id = $1`, [row.id]);
  if (!exists.rowCount) return;

  if (row.timelineNote) {
    await client.query(
      `INSERT INTO tt_transfer_timeline (transfer_id, from_party_id, to_party_id, note, actor_user_id)
       SELECT $1, $2::uuid, $3::uuid, $4, $5::uuid
       WHERE NOT EXISTS (
         SELECT 1 FROM tt_transfer_timeline WHERE transfer_id = $1 AND note = $4 LIMIT 1
       )`,
      [row.id, row.creatorPartyId, row.pendingPartyId ?? row.holderPartyId, row.timelineNote, row.actorUserId ?? null],
    );
  }
  if (row.status === "waiting" && row.pendingPartyId) {
    await client.query(
      `INSERT INTO tt_transfer_invitations (transfer_id, handoff_version, holder_party_id, pending_party_id, item_snapshot)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5)
       ON CONFLICT (transfer_id, handoff_version) DO NOTHING`,
      [row.id, row.handoffVersion ?? 1, row.holderPartyId, row.pendingPartyId, row.itemTitle],
    );
  }
}

async function seedAttachment(client, repoRoot, transferId, storageKey, name, uploadedByUserId) {
  const dup = await client.query(
    `SELECT 1 FROM tt_transfer_attachments WHERE storage_key = $1 LIMIT 1`,
    [storageKey],
  );
  if (dup.rowCount) {
    await client.query(
      `INSERT INTO tt56_user_test_fixture_provenance (storage_key) VALUES ($1) ON CONFLICT DO NOTHING`,
      [storageKey],
    );
    return;
  }

  const provenance = await client.query(
    `SELECT 1 FROM tt56_user_test_fixture_provenance WHERE storage_key = $1 LIMIT 1`,
    [storageKey],
  );
  if (provenance.rowCount) {
    return;
  }

  const absDir = process.env.TT_ATTACHMENTS_DIR?.trim() || path.join(repoRoot, "var/tt56-user-test/attachments");
  fs.mkdirSync(absDir, { recursive: true, mode: 0o700 });
  const absPath = path.join(absDir, storageKey);
  const body = `tt56 seed fixture ${name}\n`;
  if (!fs.existsSync(absPath)) {
    fs.writeFileSync(absPath, body, { mode: 0o600 });
  }

  await client.query(
    `INSERT INTO tt_transfer_attachments (transfer_id, storage_key, original_name, mime_type, byte_size, uploaded_by_user_id)
     VALUES ($1, $2, $3, 'text/plain', $4, $5::uuid)`,
    [transferId, storageKey, name, Buffer.byteLength(body), uploadedByUserId],
  );
  await client.query(
    `INSERT INTO tt56_user_test_fixture_provenance (storage_key) VALUES ($1) ON CONFLICT DO NOTHING`,
    [storageKey],
  );
}

export async function seedTanTrackerFixtures(client, ctx) {
  const { userIds, adminId, repoRoot } = ctx;
  await markLegacyDeletedFixtureAttachments(client);
  const partyA = await ensurePartyForUserOnWrite(
    client,
    userIds.employeeA,
    "TT56 Employee A",
    "+79990000001",
  );
  const partyB = await ensurePartyForUserOnWrite(
    client,
    userIds.employeeB,
    "TT56 Employee B",
    "+79990000002",
  );
  await ensurePartyForUserOnWrite(client, userIds.rop, "TT56 ROP", "+79990000003");

  await ensureExternalParty(
    client,
    FIXTURE.PARTY_EXT_RELAY,
    "TT56 External Relay",
    "+79990000011",
    userIds.employeeA,
  );
  await ensureExternalParty(
    client,
    FIXTURE.PARTY_EXT_FINAL,
    "TT56 External Final",
    "+79990000012",
    userIds.employeeA,
  );

  const inThreeDays = new Date(Date.now() + 3 * 86400000);
  const overdue = new Date(Date.now() - 2 * 86400000);

  await seedTransfer(client, {
    id: FIXTURE.TRANSFER_WAIT_AB,
    itemTitle: "TT56 Seed — handoff A→B (waiting)",
    status: "waiting",
    creatorPartyId: partyA.id,
    holderPartyId: partyA.id,
    pendingPartyId: partyB.id,
    dueAt: inThreeDays,
    timelineNote: "Seed: ожидает подтверждения B",
    actorUserId: userIds.employeeA,
  });

  await seedTransfer(client, {
    id: FIXTURE.TRANSFER_RELAY,
    itemTitle: "TT56 Seed — relay → final chain",
    status: "waiting",
    creatorPartyId: partyA.id,
    holderPartyId: partyA.id,
    pendingPartyId: FIXTURE.PARTY_EXT_RELAY,
    finalPartyId: FIXTURE.PARTY_EXT_FINAL,
    comment: "Промежуточный посредник и конечный получатель",
    timelineNote: "Seed: внешняя цепочка",
    actorUserId: userIds.employeeA,
  });

  await seedTransfer(client, {
    id: FIXTURE.TRANSFER_ACTIVE_A,
    itemTitle: "TT56 Seed — active at A (with file)",
    status: "active",
    creatorPartyId: partyA.id,
    holderPartyId: partyA.id,
    pendingPartyId: null,
    dueAt: inThreeDays,
    timelineNote: "Seed: активная у A",
    actorUserId: userIds.employeeA,
  });

  await seedTransfer(client, {
    id: FIXTURE.TRANSFER_DONE,
    itemTitle: "TT56 Seed — completed sample",
    status: "completed",
    creatorPartyId: partyA.id,
    holderPartyId: partyB.id,
    pendingPartyId: null,
    dueAt: overdue,
    timelineNote: "Seed: завершена",
    actorUserId: userIds.employeeB,
    handoffVersion: 2,
  });

  await seedAttachment(
    client,
    repoRoot,
    FIXTURE.TRANSFER_ACTIVE_A,
    "tt56-seed-active-a.txt",
    "seed-active-a.txt",
    userIds.employeeA,
  );
  await seedAttachment(
    client,
    repoRoot,
    FIXTURE.TRANSFER_WAIT_AB,
    "tt56-seed-wait-ab.txt",
    "seed-wait-ab.txt",
    userIds.employeeA,
  );

  return { partyA: partyA.id, partyB: partyB.id };
}

export { upsertEmployeeLink };
