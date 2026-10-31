import assert from "node:assert/strict";
import { it } from "node:test";
import type { Pool } from "pg";
import type { AccessContext } from "../../src/access/types";
import { assertRecipientRefEligible } from "../../src/tan-tracker/party-eligibility";

for (const role of ["admin", "director", "manager"] as const) {
  it(`native pending recipient eligibility respects existing canonical ${role} policy without writes`, async () => {
    let reads = 0;
    const userId = "55555555-5555-4555-8555-555555555555";
    const targetId = "66666666-6666-4666-8666-666666666666";
    const client = {
      query: async (sql: string) => {
        reads++;
        assert.match(sql.trim(), /^SELECT\b/iu);
        assert.ok(reads <= 1, "no global pool calls or party materialization for pending eligibility");
        return { rows: [{ id: targetId, full_name: "Eligible User", phone: null, role: "manager", status: "active" }], rowCount: 1 };
      },
    } as unknown as Pool;
    const access = { role, userId } as AccessContext;
    if (role === "admin") {
      await assertRecipientRefEligible(client, access, userId, `tt-user:${targetId}`);
    } else {
      await assert.rejects(
        assertRecipientRefEligible(client, access, userId, `tt-user:${targetId}`),
        /получател/iu,
        "do not offer a pending ref which existing canonical Create rejects for this role",
      );
    }
    assert.ok(reads <= 1);
  });
}
