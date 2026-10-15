import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

describe("client-detail-v3 composition KPI updates", () => {
  function loadV3() {
    const source = fs.readFileSync(path.join(process.cwd(), "public/client-detail-v3.js"), "utf8");
    const window: Record<string, unknown> = { location: { pathname: "/clients/x", search: "?v3Entity=holding" } };
    vm.runInNewContext(source, { window, console, document: undefined });
    return window.ClientDetailV3 as {
      renderCard: (
        shell: { escapeHtml: (v: string) => string },
        entityType: string,
        ent: Record<string, unknown>,
        holdingLink: null,
      ) => string;
      updateRelatedContext: (
        root: { querySelector: (sel: string) => { querySelectorAll: (sel: string) => { textContent: string }[] } | null },
        shell: { escapeHtml: (v: string) => string },
        payload: {
          entityType: string;
          counts: { retailOutlets: number; legalEntities: number };
        },
      ) => void;
    };
  }

  it("updateRelatedContext maps holding composition totals including zero", () => {
    const ClientDetailV3 = loadV3();
    const shell = { escapeHtml: (v: string) => v };
    const html = ClientDetailV3.renderCard(shell, "holding", { name: "Holding One", guid: "h1" }, null);
    assert.match(html, /v3-overview-kpis/);
    const kpiBoxes = [{ textContent: "—" }, { textContent: "—" }];
    const kpisEl = { querySelectorAll: (sel: string) => (sel === "b" ? kpiBoxes : []) };
    const root = {
      querySelector(sel: string) {
        if (sel === '[data-testid="v3-overview-kpis"]') return kpisEl;
        return null;
      },
      querySelectorAll: () => [],
    };
    ClientDetailV3.updateRelatedContext(root, shell, {
      entityType: "holding",
      counts: { retailOutlets: 0, legalEntities: 2 },
    });
    const values = kpiBoxes;
    assert.equal(values[0].textContent, "0");
    assert.equal(values[1].textContent, "2");
  });

  it("overview keeps unavailable dash until counts are supplied", () => {
    const ClientDetailV3 = loadV3();
    const shell = { escapeHtml: (v: string) => v };
    const html = ClientDetailV3.renderCard(shell, "holding", { name: "Holding One" }, null);
    assert.match(html, /pc-unavailable/);
  });
});
