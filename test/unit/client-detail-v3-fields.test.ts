import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

describe("client-detail-v3 field rendering", () => {
  function loadV3() {
    const source = fs.readFileSync(path.join(process.cwd(), "public/client-detail-v3.js"), "utf8");
    const window: Record<string, unknown> = { location: { pathname: "/clients/x", search: "?v3Entity=legal" } };
    vm.runInNewContext(source, { window, console });
    return window.ClientDetailV3 as {
      renderCard: (
        shell: { escapeHtml: (v: string) => string },
        entityType: string,
        ent: Record<string, unknown>,
        holdingLink: { guid: string; name: string } | null,
      ) => string;
      bindTabs: (root: { querySelector: (sel: string) => unknown }) => void;
    };
  }

  it("renders overview/data tabs, human labels, and hides SHA256", () => {
    const ClientDetailV3 = loadV3();
    const shell = { escapeHtml: (v: string) => v };
    const html = ClientDetailV3.renderCard(
      shell,
      "legal",
      {
        name_client: "Legal One",
        type_category: { guidType: "t1", nameType: "Type A", guidCategory: "c1", nameCategory: "Cat A" },
        managers: { name_manager: "Manager One", name_head_of_the_sales_department: "ROP One" },
        discount: "10%",
        discount_amount: 5,
        telephone: ["+70000000001"],
        last_imported_at: "2026-01-01T00:00:00.000Z",
        last_source_sha256: "abc123sha",
      },
      { guid: "a1000000-0000-4000-8000-000000000001", name: "Holding One" },
    );

    assert.match(html, /data-testid="v3-detail-card"/);
    assert.match(html, /pc-tab-overview/);
    assert.match(html, /pc-tab-data/);
    assert.match(html, /pc-tab-work/);
    assert.match(html, /Type A \/ Cat A/);
    assert.match(html, /Manager One/);
    assert.match(html, /ROP One/);
    assert.match(html, /Holding One/);
    assert.match(html, /Не подключено/);
    assert.doesNotMatch(html, /SHA/i);
    assert.doesNotMatch(html, /abc123sha/);
    assert.doesNotMatch(html, /guidType/);
  });

  it("renders retail passport groups with route and club", () => {
    const ClientDetailV3 = loadV3();
    const shell = { escapeHtml: (v: string) => v };
    const retailHtml = ClientDetailV3.renderCard(
      shell,
      "retail",
      {
        address: { store_address: "Store One Address", direction_of_the_route: "Route North" },
        type_category: { nameType: "Retail Type", nameCategory: "Retail Cat" },
        managers: { nameManager: "Manager One", nameHeadOfSales: "ROP One" },
        contact_information: { store_phone: "+71111111111", accountant_email: "acc@example.com" },
        lpr_information: { name: "Ivan LPR", bonus: "5%", conditions_bonus: "Annual", date_of_birth: "1980-01-02" },
        additional_information: { status_tandoor_club: "Gold", bonus_tandoor_club: "10" },
        information_loading: { loading_time: "10:00", loading_on_monday: true },
        warehouse: false,
        closed: false,
      },
      null,
    );
    assert.match(retailHtml, /Route North/);
    assert.match(retailHtml, /Retail Type \/ Retail Cat/);
    assert.match(retailHtml, /Gold/);
    assert.match(retailHtml, /Ivan LPR/);
    assert.match(retailHtml, /Магазин и доставка/);
    assert.match(retailHtml, /Контакты, ЛПР и клуб/);
  });
});
