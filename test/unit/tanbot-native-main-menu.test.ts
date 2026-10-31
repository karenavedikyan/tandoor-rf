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
    assert.match(text, /Тандор\./u);
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
    assert.ok(merged.some((c) => c.command === "start"));
    assert.equal(merged.filter((c) => c.command === "start").length, 1);
  });
});
