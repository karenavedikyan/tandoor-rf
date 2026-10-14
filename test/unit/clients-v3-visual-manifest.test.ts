import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { finalizeVisualManifest } from "../helpers/clients-v3-visual-manifest";

describe("clients v3 visual manifest finalization", () => {
  it("marks partial when a planned shot was not captured", () => {
    const result = finalizeVisualManifest({
      sha: "abc1234",
      scenariosCompleted: true,
      planned: [
        {
          file: "abc1234-a-desktop.png",
          role: "manager",
          scenario: "entry-list",
          viewport: "desktop",
          theme: "light",
          status: "captured",
        },
        {
          file: "abc1234-b-desktop.png",
          role: "manager",
          scenario: "entry-list",
          viewport: "desktop",
          theme: "light",
          status: "missing",
        },
      ],
    });
    assert.equal(result.runStatus, "partial");
    assert.equal(result.plannedCaptureCount, 2);
    assert.equal(result.capturedCount, 1);
    assert.equal(result.missingCount, 1);
  });

  it("marks partial when scenarios fail even if files exist on disk", () => {
    const result = finalizeVisualManifest({
      sha: "abc1234",
      scenariosCompleted: false,
      planned: [
        {
          file: "abc1234-a-desktop.png",
          role: "manager",
          scenario: "entry-list",
          viewport: "desktop",
          theme: "light",
          status: "captured",
        },
      ],
    });
    assert.equal(result.runStatus, "partial");
  });

  it("allows complete only when every planned capture succeeded", () => {
    const result = finalizeVisualManifest({
      sha: "abc1234",
      scenariosCompleted: true,
      planned: [
        {
          file: "abc1234-a-desktop.png",
          role: "manager",
          scenario: "entry-list",
          viewport: "desktop",
          theme: "light",
          status: "captured",
        },
        {
          file: "abc1234-a-mobile.png",
          role: "manager",
          scenario: "entry-list",
          viewport: "mobile",
          theme: "light",
          status: "captured",
        },
      ],
    });
    assert.equal(result.runStatus, "complete");
    assert.equal(result.capturedCount, 2);
    assert.equal(result.plannedCaptureCount, 2);
  });

  it("converts remaining planned entries to not-run after failure between shots", () => {
    const result = finalizeVisualManifest({
      sha: "abc1234",
      scenariosCompleted: false,
      planned: [
        {
          file: "abc1234-first-desktop.png",
          role: "manager",
          scenario: "filters",
          viewport: "desktop",
          theme: "light",
          status: "captured",
        },
        {
          file: "abc1234-second-desktop.png",
          role: "manager",
          scenario: "filters",
          viewport: "desktop",
          theme: "light",
          status: "planned",
        },
        {
          file: "abc1234-third-desktop.png",
          role: "manager",
          scenario: "filters",
          viewport: "desktop",
          theme: "light",
          status: "planned",
        },
      ],
    });
    assert.equal(result.runStatus, "partial");
    assert.equal(result.captures[1]?.status, "not-run");
    assert.equal(result.captures[2]?.status, "not-run");
    assert.equal(result.notRunCount, 2);
  });
});
