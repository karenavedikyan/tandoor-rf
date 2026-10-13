import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

describe("client-detail-v3 field rendering", () => {
  it("renders camelCase managers, type/category, route and club values", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "public/client-detail-v3.js"), "utf8");
    const window: Record<string, unknown> = {};
    vm.runInNewContext(source, { window, console });
    const ClientDetailV3 = window.ClientDetailV3 as {
      renderBody: (
        shell: { escapeHtml: (v: string) => string },
        entityType: string,
        ent: Record<string, unknown>,
        holdingLink: null,
      ) => string;
    };
    const shell = { escapeHtml: (v: string) => v };
    const legalHtml = ClientDetailV3.renderBody(shell, "legal", {
      name_client: "Legal One",
      type_category: { guidType: "t1", nameType: "Type A", guidCategory: "c1", nameCategory: "Cat A" },
      managers: { nameManager: "Manager One", nameHeadOfSales: "ROP One" },
      discount: "10%",
      discount_amount: 5,
      telephone: ["+70000000001"],
    }, null);
    assert.match(legalHtml, /Type A \/ Cat A/);
    assert.match(legalHtml, /Manager One/);
    assert.match(legalHtml, /ROP One/);

    const retailHtml = ClientDetailV3.renderBody(shell, "retail", {
      address: { store_address: "Store One Address", direction_of_the_route: "Route North" },
      type_category: { nameType: "Retail Type", nameCategory: "Retail Cat" },
      managers: { nameManager: "Manager One", nameHeadOfSales: "ROP One" },
      contact_information: { store_phone: "+71111111111", accountant_email: "acc@example.com" },
      lpr_information: { name: "Ivan LPR", bonus: "5%", conditions_bonus: "Annual", date_of_birth: "1980-01-02" },
      additional_information: { status_tandoor_club: "Gold", bonus_tandoor_club: "10" },
      information_loading: { loading_time: "10:00", loading_on_monday: true },
      warehouse: false,
      closed: false,
    }, null);
    assert.match(retailHtml, /Route North/);
    assert.match(retailHtml, /Retail Type \/ Retail Cat/);
    assert.match(retailHtml, /Gold/);
    assert.match(retailHtml, /Ivan LPR/);
    assert.match(retailHtml, /\+71111111111/);
    assert.match(retailHtml, /Annual/);
  });
});
