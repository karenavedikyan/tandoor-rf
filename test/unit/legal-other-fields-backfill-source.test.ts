import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseClientsOtherFromJsonBytes } from "../../src/onec-exchange-v3/legal-other-fields-backfill/parse-clients-file";
import { validateClientsSourceForBackfill } from "../../src/onec-exchange-v3/legal-other-fields-backfill/source-validation";
import { rollbackLegalOtherFieldsFromSnapshot } from "../../src/onec-exchange-v3/legal-other-fields-backfill/rollback";

describe("legal other_fields backfill source validation", () => {
  const guid = "b2000000-0000-4000-8000-000000000001";

  it("rejects duplicate guids and invalid records before planning", () => {
    const parsed = parseClientsOtherFromJsonBytes(
      Buffer.from(
        JSON.stringify([
          { guid_client: guid, name_client: "A", other: { Код: "1" } },
          { guid_client: guid, name_client: "A", other: { Код: "2" } },
          { guid_client: "not-a-guid", name_client: "B" },
        ]),
      ),
    );
    const validation = validateClientsSourceForBackfill(parsed);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.equal(validation.code, "DUPLICATE_GUIDS");
    }
  });
});

describe("legal other_fields rollback guard", () => {
  it("does not rollback when current row diverged from expected post snapshot", async () => {
    const guid = "b2000000-0000-4000-8000-000000000001";
    const previous = { Код: "OLD" };
    const expectedPost = { Код: "NEW" };
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rowCount: 0 };
      },
    };
    const result = await rollbackLegalOtherFieldsFromSnapshot(client as never, [
      {
        guidClient: guid,
        previousHash: "a",
        postHash: "b",
        previousOtherFields: previous,
        lastSourceSha256: "c".repeat(64),
        expectedPostOtherFields: expectedPost,
      },
    ]);
    assert.equal(result.rolledBack, 0);
    assert.equal(result.skippedGuard, 1);
    assert.match(queries[0], /other_fields = \$4::jsonb/);
    assert.match(queries[0], /last_source_sha256/);
  });
});
