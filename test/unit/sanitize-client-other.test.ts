import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessContext } from "../../src/access/types";
import {
  isBlockedClientOtherKey,
  presentLegalOtherFieldsForApi,
  sanitizeClientOtherFields,
} from "../../src/onec-exchange-v3/sanitize-client-other";

function managerContext(): AccessContext {
  return {
    role: "manager",
    userId: 1,
    fullClientBase: false,
    employeeId: null,
    employeeLinkConflict: false,
    deniedClientGuids: new Set(),
    deniedEmployeeGuids: new Set(),
  } as AccessContext;
}

describe("sanitize-client-other", () => {
  it("blocks credential-like keys at top level and nested", () => {
    assert.ok(isBlockedClientOtherKey("ApiToken"));
    assert.ok(isBlockedClientOtherKey("Пароль"));
    assert.ok(isBlockedClientOtherKey("Токен"));
    assert.ok(isBlockedClientOtherKey("Секрет"));
    assert.ok(isBlockedClientOtherKey("КлючДоступа"));
    assert.ok(isBlockedClientOtherKey("Ключ_Доступа"));
    assert.ok(!isBlockedClientOtherKey("Оптовик_Категория"));
    const picked = sanitizeClientOtherFields({
      Код: "001",
      ApiToken: "SYNTH",
      Пароль: "SYNTH",
      Токен: "SYNTH",
      Секрет: "SYNTH",
      КлючДоступа: "SYNTH",
      Future: { password: "SYNTH", note: "ok" },
      __proto__: { polluted: true },
    });
    assert.equal(picked.Код, "001");
    assert.equal(picked.ApiToken, undefined);
    assert.equal(picked.Пароль, undefined);
    assert.equal(picked.Токен, undefined);
    assert.equal(picked.Секрет, undefined);
    assert.equal(picked.КлючДоступа, undefined);
    assert.deepEqual(picked.Future, { note: "ok" });
    assert.equal(Object.hasOwn(picked, "__proto__"), false);
  });

  it("filters restricted legal other fields for non-privileged roles", () => {
    const raw = {
      Код: "001",
      ГруппаДоступа: "X",
      ДатаРождения: "1980-01-01",
      Пол: "М",
      Оптовик_КонтактноеЛицо: "Person",
    };
    const manager = presentLegalOtherFieldsForApi(raw, managerContext());
    assert.equal(manager.Код, "001");
    assert.equal(manager.Оптовик_КонтактноеЛицо, "Person");
    assert.equal(manager.ГруппаДоступа, undefined);
    assert.equal(manager.ДатаРождения, undefined);

    const admin = presentLegalOtherFieldsForApi(raw, {
      ...managerContext(),
      role: "admin",
    } as AccessContext);
    assert.equal(admin.ГруппаДоступа, "X");
  });

  it("drops forged internal complete marker from exchange JSON", () => {
    const picked = sanitizeClientOtherFields({
      Код: "001",
      __v3ExchangeOtherComplete: "forged-sha",
    });
    assert.equal(picked.Код, "001");
    assert.equal(picked.__v3ExchangeOtherComplete, undefined);
  });

  it("blocks compound Russian credential key variants", () => {
    const picked = sanitizeClientOtherFields({
      ПарольFTP: "SYNTH",
      Пароль_1С: "SYNTH",
      ТокенДоступа: "SYNTH",
      СекретАвторизации: "SYNTH",
      Оптовик_Категория: "ok",
    });
    assert.equal(picked.ПарольFTP, undefined);
    assert.equal(picked.Пароль_1С, undefined);
    assert.equal(picked.ТокенДоступа, undefined);
    assert.equal(picked.СекретАвторизации, undefined);
    assert.equal(picked.Оптовик_Категория, "ok");
  });

  it("strips nested restricted fields for non-privileged roles", () => {
    const manager = presentLegalOtherFieldsForApi(
      {
        Future: { Пол: "SYNTH", ДатаРождения: "SYNTH", ГруппаДоступа: "SYNTH", note: "ok" },
      },
      managerContext(),
    );
    assert.deepEqual(manager.Future, { note: "ok" });
  });

  it("strips restricted fields inside nested arrays", () => {
    const manager = presentLegalOtherFieldsForApi(
      {
        Future: [{ Пол: "SYNTH", ДатаРождения: "SYNTH", ГруппаДоступа: "SYNTH", note: "OK" }],
      },
      managerContext(),
    );
    assert.deepEqual(manager.Future, [{ note: "OK" }]);
  });
});
