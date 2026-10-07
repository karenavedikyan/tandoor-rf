import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toRetailOutletListItem } from "../../src/clients/dto";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const STORE = "44444444-4444-4444-8444-444444444444";

describe("retail outlet list dto assignments", () => {
  it("uses outlet-level manager for Менеджер ТТ and keeps client manager separate", () => {
    const item = toRetailOutletListItem({
      guid_store: STORE,
      guid_client: CLIENT,
      client_name: "Client Alpha",
      is_closed: false,
      store_address: "Store 1",
      name_holding: "Holding",
      guid_manager: M1,
      name_manager: "Manager One",
      outlet_snapshot: {
        managers: {
          manager: {
            guid: M2,
            name: "Manager Two",
            state: "directory_unverified",
          },
          regionalManager: { guid: null, name: "", state: "unassigned" },
          hardwareManager: { guid: null, name: "", state: "not_provided" },
          headOfSales: { guid: null, name: "", state: "unassigned" },
        },
      },
    });

    assert.equal(item.clientManager.id, M1);
    assert.equal(item.clientManager.name, "Manager One");
    assert.equal(item.manager.id, M2);
    assert.equal(item.manager.assignmentLabel, "Manager Two · 22222222");
    assert.notEqual(item.manager.id, item.clientManager.id);
    assert.equal(item.regionalManager.assignmentLabel, "Не назначен");
    assert.equal(item.hardwareManager.assignmentLabel, "Не передано");
  });

  it("does not fall back to client manager when outlet manager is unassigned", () => {
    const item = toRetailOutletListItem({
      guid_store: STORE,
      guid_client: CLIENT,
      client_name: "Client Alpha",
      is_closed: false,
      store_address: "Store 1",
      name_holding: "Holding",
      guid_manager: M1,
      name_manager: "Manager One",
      outlet_snapshot: {
        managers: {
          manager: { guid: null, name: "", state: "unassigned" },
          regionalManager: { guid: null, name: "", state: "not_provided" },
          hardwareManager: { guid: null, name: "", state: "not_provided" },
          headOfSales: { guid: null, name: "", state: "not_provided" },
        },
      },
    });

    assert.equal(item.manager.assignmentLabel, "Не назначен");
    assert.equal(item.clientManager.id, M1);
  });
});
