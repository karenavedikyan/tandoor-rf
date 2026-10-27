import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

describe("client-detail-v3 field rendering", () => {
  function loadV3() {
    const catalogSource = fs.readFileSync(
      path.join(process.cwd(), "public/client-detail-exchange-catalog.js"),
      "utf8",
    );
    const source = fs.readFileSync(path.join(process.cwd(), "public/client-detail-v3.js"), "utf8");
    const window: Record<string, unknown> = { location: { pathname: "/clients/x", search: "?v3Entity=legal" } };
    vm.runInNewContext(catalogSource, { window, console });
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
    assert.match(html, /ТОП: Type A/);
    assert.match(html, /Manager One/);
    assert.match(html, /ROP One/);
    assert.match(html, /Holding One/);
    assert.match(html, /Торговые точки/);
    assert.match(html, /Юридические лица/);
    assert.match(html, /Точки и контакты/);
    assert.match(html, /GUID:/);
    assert.match(html, /v3-data-sequential/);
    assert.match(html, /Клиент и холдинг/);
    assert.doesNotMatch(html, /v3-role-context/);
    assert.match(html, /Не подключено/);
    assert.match(html, /Данные появятся после загрузки из 1С/);
    assert.match(html, /01\.01\.2026,?\s+03:00 МСК/);
    assert.doesNotMatch(html, /SHA/i);
    assert.doesNotMatch(html, /abc123sha/);
    assert.doesNotMatch(html, /guidType/);
  });

  it("keeps pending, imported-empty and restricted 1C fields distinct", () => {
    const card = loadV3();
    const shell = { escapeHtml: (v: string) => v };
    const render = (fields: Record<string, unknown>) =>
      card.renderCard(shell, "legal", { name_client: "Legal", ...fields }, null);
    const pending = render({});
    assert.match(pending, /Данные появятся после загрузки из 1С/);
    assert.match(pending, /Контактное лицо/);
    const imported = render({ other_fields_exchange_complete: true });
    assert.match(imported, /Нет данных из 1С/);
    assert.doesNotMatch(imported, /Данные появятся после загрузки из 1С/);
    const restricted = render({
      other_fields_exchange_complete: true,
      other_field_states: { Оптовик_КонтактноеЛицо: "restricted" },
    });
    assert.match(restricted, /Скрыто политикой доступа/);
    assert.match(restricted, /Контактное лицо/);
  });

  it("renders other_fields without object toString", () => {
    const ClientDetailV3 = loadV3();
    const shell = { escapeHtml: (v: string) => v };
    const html = ClientDetailV3.renderCard(
      shell,
      "legal",
      {
        name_client: "Legal",
        type_category: { name_type: "T", name_category: "C" },
        other_fields: {
          Код: "001",
          Оптовик_РетроБонус: "10%",
          Оптовик_КонтактноеЛицо: "SYNTH Contact",
          Оптовик_СтатусКлиента: "Active",
          nested: { flag: true },
        },
      },
      null,
    );
    assert.doesNotMatch(html, /\[object Object\]/);
    assert.match(html, /Ретро-бонус/);
    assert.match(html, /10%/);
    assert.match(html, /SYNTH Contact/);
    assert.match(html, /Статус клиента/);
  });

  it("formats exchange dates by field semantics", () => {
    const ClientDetailV3 = loadV3();
    const shell = { escapeHtml: (v: string) => v };
    const html = ClientDetailV3.renderCard(
      shell,
      "legal",
      {
        name_client: "Legal",
        type_category: { name_type: "TOP350" },
        other_fields: {
          Оптовик_ДатаСледКонтакта: "0001-01-01T00:00:00",
          Оптовик_НеблагонадёжныйДата: "01.01.0001 0:00:00",
          Оптовик_КонтактноеЛицо: null,
        },
      },
      null,
    );
    assert.match(html, /Нет данных из 1С/);
    assert.doesNotMatch(html, /00:00/);
    assert.doesNotMatch(html, /01\.01\.0001/);
    assert.match(html, /Контактное лицо/);
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
    assert.match(retailHtml, /ТОП: Retail Type/);
    assert.match(retailHtml, /Gold/);
    assert.match(retailHtml, /Ivan LPR/);
    assert.match(retailHtml, /Доставка и приёмка/);
    assert.match(retailHtml, /Контакты, ЛПР и Club/);
  });
});
