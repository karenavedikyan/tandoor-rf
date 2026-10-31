import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeManagedBotCommands,
  runNativeBotCommandInstall,
  buildNativeBotCommandInstallPlan,
  MANAGED_NATIVE_BOT_COMMANDS,
} from "../../src/tanbot/native-create/bot-command-registry";
import {
  parseNativeBotSlashCommand,
  NATIVE_MAIN_MENU_ACTION_PROMPT,
  nativeMainMenuText,
  isNativeCreateMenuText,
} from "../../src/tanbot/native-create/main-menu";

describe("native main menu helpers", () => {
  it("parseNativeBotSlashCommand accepts exact commands with optional @bot suffix", () => {
    assert.equal(parseNativeBotSlashCommand("/start"), "start");
    assert.equal(parseNativeBotSlashCommand("/start@Tandoor_bot"), "start");
    assert.equal(parseNativeBotSlashCommand("/menu"), "menu");
    assert.equal(parseNativeBotSlashCommand("/my@bot"), "my");
    assert.equal(parseNativeBotSlashCommand("/new"), "new");
    assert.equal(parseNativeBotSlashCommand("/mystery"), null);
    assert.equal(parseNativeBotSlashCommand("/start token"), null);
    assert.equal(parseNativeBotSlashCommand("/my transfers"), null);
  });

  it("isNativeCreateMenuText accepts exact create aliases without prefix swallowing", () => {
    assert.equal(isNativeCreateMenuText("/send"), true);
    assert.equal(isNativeCreateMenuText("/create@Tandoor_bot"), true);
    assert.equal(isNativeCreateMenuText("Оформить передачу"), true);
    assert.equal(isNativeCreateMenuText("/new"), true);
    assert.equal(isNativeCreateMenuText("/new@bot"), true);
    assert.equal(isNativeCreateMenuText("/newer"), false);
    assert.equal(isNativeCreateMenuText("/startled"), false);
  });

  it("nativeMainMenuText includes Tandoor greeting and action prompt", () => {
    const text = nativeMainMenuText({
      channel: "telegram",
      messengerChatId: "1",
      messengerUserId: 1n,
      privateDialogOk: true,
      isLinkedStaff: false,
      staffUserId: null,
      personId: null,
    });
    assert.match(text, /^Тандор\n/u);
    assert.match(text, new RegExp(NATIVE_MAIN_MENU_ACTION_PROMPT));
  });
});

describe("native bot command install registry", () => {
  it("defaults to dry-run without network", async () => {
    const plan = buildNativeBotCommandInstallPlan("telegram", { dryRun: true });
    const result = await runNativeBotCommandInstall(plan);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.dryRun, true);
      assert.equal(result.mergedCount, MANAGED_NATIVE_BOT_COMMANDS.length);
    }
  });

  it("mergeManagedBotCommands keeps custom commands", () => {
    const merged = mergeManagedBotCommands([{ command: "status", description: "Status" }], MANAGED_NATIVE_BOT_COMMANDS);
    assert.ok(merged.some((c) => c.command === "status"));
    assert.ok(merged.some((c) => c.command === "menu"));
    assert.equal(merged.filter((c) => c.command === "menu").length, 1);
  });

  it("hides only the redundant command suggestion and preserves /start routing", () => {
    const plan = buildNativeBotCommandInstallPlan("max");
    const merged = mergeManagedBotCommands(
      [{ command: "start", description: "Главное меню Тандор" },
        { command: "support", description: "Поддержка" }], plan.commands, plan.hiddenCommands);
    assert.deepEqual(merged.map(c => c.command), ["menu", "new", "my", "support"]);
    assert.equal(parseNativeBotSlashCommand("/start"), "start");
    assert.equal(parseNativeBotSlashCommand("/start@Tandoor_bot"), "start");
    assert.equal(parseNativeBotSlashCommand("/start recipient-token"), null, "deep links retain their separate handler");
  });

  it("apply without explicit transport fails closed", async () => {
    const plan = buildNativeBotCommandInstallPlan("telegram", { dryRun: false });
    const result = await runNativeBotCommandInstall(plan);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /explicit transport/i);
    }
  });

  it("apply uses injected mock transport without network", async () => {
    let calls = 0;
    const plan = buildNativeBotCommandInstallPlan("max", { dryRun: false });
    const result = await runNativeBotCommandInstall(plan, async () => {
      calls += 1;
      return { ok: true, dryRun: false, mergedCount: plan.commands.length };
    });
    assert.equal(calls, 1);
    assert.equal(result.ok, true);
  });
});
