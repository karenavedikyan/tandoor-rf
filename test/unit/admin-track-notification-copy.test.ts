import assert from "node:assert/strict";
import { it } from "node:test";
import { staffNotificationLkCopy, staffNotificationMessengerText } from "../../src/tan-tracker/staff-notification-copy";

for (const creatorKind of ["staff", "external"] as const) {
  it(`administrative creation copy identifies ${creatorKind}, contains no receive-code action`, () => {
    const payload = { transferId: "TT-2026-042", publicCode: "TT-2026-042", itemTitle: "Документы",
      handoffVersion: 1, creatorKind, routeFromDisplayName: "Автор", routeToDisplayName: "Получатель" };
    const message = staffNotificationMessengerText("tan_tracker.admin_created", payload, "https://lk.tandoor.ru");
    assert.match(message, /Создан новый трек/);
    assert.match(message, new RegExp(creatorKind === "staff" ? "сотрудник" : "внешний пользователь"));
    assert.match(message, /https:\/\/lk\.tandoor\.ru\/tan-tracker#\?tt_screen=detail&tt_id=TT-2026-042/);
    assert.doesNotMatch(message, /Ввести код|Подтвердите приём|Сообщите код/);
    assert.equal(staffNotificationLkCopy("tan_tracker.admin_created", payload).title, "Новый трек · для администратора");
  });
}
