import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toClientExtendedDto } from "../../src/clients/extended-dto";
import type { ParsedManagerRef, ParsedRetailOutlet } from "../../src/onec-clients/extended-types";

describe("clients extended dto", () => {
  it("withholds LPR and bonus fields from API dto", () => {
    const outlet: ParsedRetailOutlet = {
      ordinal: 0,
      holdingName: "H1",
      warehouse: true,
      address: { storeAddress: "A", deliveryAddress: "B", routeDirection: "N" },
      loading: {
        loadingOnMonday: true,
        loadingOnTuesday: null,
        loadingOnWednesday: null,
        loadingOnThursday: null,
        loadingOnFriday: null,
        loadingOnSaturday: null,
        loadingOnSunday: null,
        loadingTime: "09:00",
      },
      managers: {
        manager: { guid: null, name: "", state: "unassigned" },
        regionalManager: { guid: null, name: "", state: "unassigned" },
        hardwareManager: { guid: null, name: "", state: "unassigned" },
        headOfSales: { guid: null, name: "", state: "unassigned" },
      },
      contacts: { storePhone: "1", accountantPhone: "2", accountantEmail: "a@b.c" },
      lpr: {
        name: "Secret",
        post: "CEO",
        dateOfBirth: "1980-01-01",
        phone: "secret",
        email: "secret@x.test",
        bonus: "100",
        conditionsBonus: "cond",
      },
      additional: { statusTandoorClub: "x", bonusTandoorClub: "y" },
      outletGuidStatus: "not_provided",
      closureStatus: "not_provided",
      distributionAllowed: false,
      presentInCurrentSnapshot: true,
    };

    const dto = toClientExtendedDto({
      is_holding: true,
      extended_format_version: "extended_v1",
      extended_source_sha256: "abc",
      extended_snapshot: {
        sourceSha256: "abc",
        regionalManager: { guid: null, name: "", state: "unassigned" } satisfies ParsedManagerRef,
        hardwareManager: { guid: null, name: "", state: "unassigned" },
        headOfSales: { guid: null, name: "", state: "unassigned" },
        retailOutlets: [outlet],
      },
    });

    assert.ok(dto);
    assert.equal(dto!.sensitiveFieldsWithheld, true);
    const serialized = JSON.stringify(dto);
    assert.doesNotMatch(serialized, /Secret|secret@x|conditions_bonus|bonus_tandoor/i);
  });

  it("labels unmatched manager separately from unassigned", () => {
    const dto = toClientExtendedDto({
      is_holding: false,
      extended_format_version: "extended_v1",
      extended_source_sha256: "abc",
      extended_snapshot: {
        regionalManager: { guid: "99999999-9999-4999-8999-999999999999", name: "Unknown Person", state: "unmatched" },
        hardwareManager: { guid: null, name: "", state: "unassigned" },
        headOfSales: { guid: null, name: "", state: "unassigned" },
        retailOutlets: [],
      },
    });
    assert.equal(dto!.managers.regionalManager.assignmentLabel, "Unknown Person · Сотрудник не сопоставлен");
    assert.equal(dto!.managers.hardwareManager.assignmentLabel, "Не назначен");
  });
});
