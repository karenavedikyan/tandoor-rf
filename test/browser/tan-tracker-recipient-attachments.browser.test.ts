import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { getPool } from "../../src/db/pool";
import { createTestUser } from "../helpers/test-db";
import { ensurePartyForUserOnWrite } from "../../src/tan-tracker/repository";
import { writeAttachmentBytes } from "../../src/tan-tracker/attachment-storage";
import { signExternalPersonCapability } from "../../src/tan-tracker/external-person/session-token";
import { createPersonBrowserSession, revokeAllExternalPersonSessions } from "../../src/tan-tracker/external-person/person-service";
import { startBrowserHttpFixture, stopBrowserHttpFixture, type BrowserHttpFixture } from "./helpers/http-integration-browser";

describe("recipient sees shared track information and attachments", { concurrency: false }, () => {
  let fixture: BrowserHttpFixture;
  let recipient: string, recipientPerson: string, former: string, stranger: string, staff: string, staffUser: string;
  let est: string, cap: string, strangerCap: string, formerCap: string;
  let photo: string, documentFile: string, outsiderFile: string;
  const internalId = "recipient-attachment-internal";
  const publicCode = "TT-2026-948";
  const title = "Посылка с фотографией и документом";
  const bytes = Buffer.from("shared-track-document");
  const adminEmail = "recipient-file-admin@test.local";

  before(async () => {
    fixture = await startBrowserHttpFixture({
      attachmentsDir: "var/tt-recipient-attachments-browser",
      extraEnv: { TT_OTP_PEPPER: "synthetic-recipient-attachment-pepper", TANBOT_MAX_ENABLED: "false" },
    });
    const pool = getPool()!;
    const user = await createTestUser({ databaseUrl: fixture.databaseUrl, email: adminEmail,
      password: fixture.password, fullName: "Отправитель Тест", role: "admin" });
    staffUser = user.id;
    staff = (await ensurePartyForUserOnWrite(pool, user.id, "Отправитель Тест", "+79990004101")).id;
    const client = await pool.connect();
    try {
      const external = async (name: string, phone: string, messenger: string) => {
        const party = (await client.query(
          "INSERT INTO tt_parties(kind,display_name,phone_e164) VALUES('external',$1,$2) RETURNING id", [name, phone],
        )).rows[0].id as string;
        const person = (await client.query(
          "INSERT INTO tt_external_persons(party_id,display_name,phone_e164) VALUES($1,$2,$3) RETURNING id",
          [party, name, phone],
        )).rows[0].id as string;
        await client.query(
          "INSERT INTO tt_external_person_verifications(person_id,channel,messenger_user_id,messenger_chat_id) VALUES($1,'max',$2,$2)",
          [person, messenger],
        );
        return { party, person, cap: signExternalPersonCapability(person, 3600000, 1),
          est: await createPersonBrowserSession(client, person, "max") };
      };
      const r = await external("Получатель Тест", "+79990004102", "94102");
      recipient = r.party; recipientPerson = r.person; est = r.est; cap = r.cap;
      const f = await external("Предыдущее звено", "+79990004103", "94103");
      former = f.party; formerCap = f.cap;
      const s = await external("Посторонний контакт", "+79990004104", "94104");
      stranger = s.party; strangerCap = s.cap;
      await client.query(
        `INSERT INTO tt_transfers(id,public_code,item_title,qty_label,comment_text,status,creator_party_id,holder_party_id,final_recipient_party_id,first_custody_at,handoff_version)
         VALUES($1,$2,$3,'2 коробки','Хрупкое, хранить вертикально','active',$4,$5,$5,NOW(),3),
               ('recipient-attachment-outsider','TT-2026-949','Чужая посылка',NULL,'Чужое описание','active',$4,$6,$6,NOW(),1)`,
        [internalId, publicCode, title, staff, recipient, stranger],
      );
      await client.query(
        `INSERT INTO tt_transfer_timeline(transfer_id,from_party_id,to_party_id,note,occurred_at)
         VALUES($1,$2,$3,'Первый этап упаковки',NOW()-INTERVAL '2 hours'),
               ($1,$3,$4,'Передано получателю',NOW()-INTERVAL '1 hour')`,
        [internalId, staff, former, recipient],
      );
      const attach = async (transferId: string, name: string, mime: string, content: Buffer, uploader: string | null) => {
        const id = randomUUID(), key = `recipient-test/${id}`;
        await writeAttachmentBytes(client, key, content);
        await client.query(
          `INSERT INTO tt_transfer_attachments(id,transfer_id,storage_key,original_name,mime_type,byte_size,uploaded_by_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, transferId, key, name, mime, content.length, uploader],
        );
        return id;
      };
      photo = await attach(internalId, "Фото упаковки.png", "image/png",
        await readFile("test/fixtures/tan-tracker-admin-wizard.png"), staffUser);
      documentFile = await attach(internalId, "Опись.txt", "text/plain", bytes, null);
      outsiderFile = await attach("recipient-attachment-outsider", "Чужой файл.txt", "text/plain", bytes, staffUser);
    } finally { client.release(); }
  });
  after(async () => { if (fixture) await stopBrowserHttpFixture(fixture); });

  async function bootstrap(token = cap) {
    const r = await fetch(`${fixture.baseUrl}/api/tan-tracker/public/external/bootstrap?cap=${encodeURIComponent(token)}`);
    assert.equal(r.status, 200);
    return r.json();
  }
  function fileUrl(id: string, token = cap, transfer = publicCode, query = "") {
    return `${fixture.baseUrl}/api/tan-tracker/public/external/attachments/${id}?cap=${encodeURIComponent(token)}&transferId=${transfer}${query}`;
  }

  for (const role of ["holder", "pending", "final"] as const) {
    it(`${role} sees all shared files, description, route and earlier history, not unrelated tracks`, async () => {
      const pool = getPool()!;
      await pool.query(
        `UPDATE tt_transfers SET holder_party_id=$2,pending_party_id=$3,final_recipient_party_id=$4 WHERE id=$1`,
        [internalId, role === "holder" ? recipient : staff,
          role === "pending" ? recipient : null, role === "final" ? recipient : staff],
      );
      try {
        const data = await bootstrap();
        assert.equal(data.orders.length, 1);
        const order = data.orders[0];
        assert.deepEqual(order.attachments.map((a: { id: string }) => a.id).sort(), [photo, documentFile].sort());
        assert.equal(order.comment, "Хрупкое, хранить вертикально");
        assert.equal(order.qty, "2 коробки");
        assert.equal(order.timeline.length, 2);
        assert.equal(order.timeline[0].note, "Первый этап упаковки");
        assert.ok(data.contacts.some((c: { id: string; name: string }) => c.id === former && c.name === "Предыдущее звено"));
        assert.ok(data.contacts.some((c: { id: string }) => c.id === staff));
        assert.ok(!data.contacts.some((c: { id: string }) => c.id === stranger));
        assert.equal((await fetch(fileUrl(photo))).status, 200);
      } finally {
        await pool.query("UPDATE tt_transfers SET holder_party_id=$2,pending_party_id=NULL,final_recipient_party_id=$2 WHERE id=$1", [internalId, recipient]);
      }
    });
  }

  it("serves employee-uploaded photo previews and original external files with safe download headers", async () => {
    const preview = await fetch(fileUrl(photo, cap, publicCode, "&preview=thumb"));
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-type")!, /^image\//);
    const download = await fetch(fileUrl(documentFile, cap, publicCode, "&download=1"));
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.match(download.headers.get("content-disposition")!, /attachment/);
    assert.match(download.headers.get("content-disposition")!, /filename/);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(download.headers.get("cache-control"), "no-store");
  });

  it("blocks another track, substituted attachment IDs, timeline-only participants and invalid capabilities", async () => {
    for (const url of [
      fileUrl(outsiderFile), fileUrl(photo, strangerCap), fileUrl(photo, formerCap),
      fileUrl(photo, "invalid"), fileUrl(photo, cap, "TT-2026-949"),
    ]) assert.equal((await fetch(url)).status, 403, url.replace(/cap=[^&]+/, "cap=redacted"));
    const historical = await bootstrap(formerCap);
    assert.equal(historical.orders.length, 0);
    assert.ok(historical.historicalSummaries.some((o: { id: string }) => o.id === publicCode));
    const pool = getPool()!;
    await pool.query("UPDATE tt_transfers SET holder_party_id=$2,final_recipient_party_id=$2 WHERE id=$1", [internalId, staff]);
    try { assert.equal((await fetch(fileUrl(photo))).status, 403); }
    finally { await pool.query("UPDATE tt_transfers SET holder_party_id=$2,final_recipient_party_id=$2 WHERE id=$1", [internalId, recipient]); }
  });

  it("admin and recipient see the same files; mobile recipient can preview and download without logging in as employee", async () => {
    const context = await fixture.browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    try {
      await page.goto(`${fixture.baseUrl}/login`);
      await page.fill("#email", adminEmail);
      await page.fill("#password", fixture.password);
      await page.click("#login-button");
      await page.waitForURL(/\/(clients|profile|work|access|admin)(\/|\?|$)/);
      const admin = await context.request.get(`${fixture.baseUrl}/api/tan-tracker/bootstrap`);
      assert.equal(admin.status(), 200);
      const order = (await admin.json()).orders.find((o: { id: string }) => o.id === publicCode);
      assert.deepEqual(order.attachments.map((a: { id: string }) => a.id).sort(), [photo, documentFile].sort());
      await context.clearCookies();
      await page.goto(`${fixture.baseUrl}/tan-tracker?est=${encodeURIComponent(est)}`);
      await page.locator('[data-testid="tan-tracker"]').getByText(title, { exact: true }).first().click();
      const disclosure = page.locator('[data-tt="detail-attachments-disclosure"]');
      await disclosure.locator("summary").click();
      assert.match(await disclosure.innerText(), /Фото упаковки\s*\.png/);
      assert.match(await disclosure.innerText(), /Опись\s*\.txt/);
      assert.doesNotMatch(await disclosure.innerText(), /Нет вложений/);
      const image = disclosure.locator("img").first();
      await image.waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-tt="detail-attachments-disclosure"] img')]
        .some(img => (img as HTMLImageElement).naturalWidth > 0));
      await disclosure.locator(`[data-tt="attach-preview"][data-att-id="${photo}"]`).first().click();
      await page.getByRole("dialog", { name: "Просмотр вложения" }).waitFor();
      await page.waitForFunction(() => (document.querySelector('[data-tt="attach-lightbox-img"]') as HTMLImageElement)?.naturalWidth > 0);
      await page.locator('[data-tt="attach-lightbox-close"]').click();
      const pendingDownload = page.waitForEvent("download");
      await disclosure.locator(`[data-tt="attach-download"][data-att-id="${documentFile}"]`).click();
      const download = await pendingDownload;
      assert.equal(await download.failure(), null, `Download failed: ${new URL(download.url()).pathname}`);
      assert.deepEqual(await readFile((await download.path())!), bytes);
      const downloadedResponse = await context.request.get(download.url());
      assert.match(downloadedResponse.headers()["content-disposition"]!, new RegExp(encodeURIComponent("Опись.txt").replace(/\./g, "\\.")));
      assert.equal(await disclosure.locator(`[data-tt="attach-download"][data-att-id="${documentFile}"]`).getAttribute("download"), "Опись.txt");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: "/tmp/tandoor-recipient-attachments-mobile.png", fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      assert.match(await disclosure.innerText(), /Фото упаковки\s*\.png/);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  it("preserves limited former-creator access without exposing later employee files", async () => {
    const pool = getPool()!;
    await pool.query(
      `INSERT INTO tt_transfers(id,public_code,item_title,status,from_external,creator_party_id,holder_party_id,final_recipient_party_id)
       VALUES('former-external-created','TT-2026-950','Исходный запрос','active',TRUE,$1,$2,$2)`, [former, staff],
    );
    const ids: string[] = [];
    for (const uploader of [null, staffUser]) {
      const id = randomUUID();
      ids.push(id);
      await writeAttachmentBytes(pool, `recipient-test/${id}`, bytes);
      await pool.query(
        `INSERT INTO tt_transfer_attachments(id,transfer_id,storage_key,original_name,mime_type,byte_size,uploaded_by_user_id)
         VALUES($1,'former-external-created',$2,'original.txt','text/plain',$3,$4)`,
        [id, `recipient-test/${id}`, bytes.length, uploader],
      );
    }
    const data = await bootstrap(formerCap);
    assert.deepEqual(data.orders.find((o: { id: string }) => o.id === "TT-2026-950").attachments.map((a: { id: string }) => a.id), [ids[0]]);
    assert.equal((await fetch(fileUrl(ids[0]!, formerCap, "TT-2026-950"))).status, 200);
    assert.equal((await fetch(fileUrl(ids[1]!, formerCap, "TT-2026-950"))).status, 403);
  });

  it("rejects expired, outdated-epoch and revoked recipient credentials", async () => {
    for (const token of [
      signExternalPersonCapability(recipientPerson, -1000, 1),
      signExternalPersonCapability(recipientPerson, 3600000, 0),
    ]) assert.equal((await fetch(fileUrl(photo, token))).status, 403);
    const client = await getPool()!.connect();
    try { await revokeAllExternalPersonSessions(client, recipientPerson); }
    finally { client.release(); }
    assert.equal((await fetch(fileUrl(photo))).status, 403);
    assert.equal((await fetch(`${fixture.baseUrl}/api/tan-tracker/public/external/attachments/${photo}?est=${est}&transferId=${publicCode}`)).status, 403);
  });
});
