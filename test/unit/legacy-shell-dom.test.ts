import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);

type ShellModule = {
  mountShell: (active: string, options?: { showClients?: boolean }) => void;
  applyTheme: (theme: "light" | "dark") => void;
  readTheme: () => "light" | "dark";
  setMobileMenuOpen: (open: boolean) => void;
};

type SectionsModule = {
  renderAllSections: (returnQuery: string) => string;
  initCollapsibles: (root: ParentNode) => void;
  PENDING_NOTICE: string;
  REQUISITES_LABELS: string[];
};

function loadBrowserModules() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/clients",
  });
  const { window } = dom;
  (globalThis as { window?: Window }).window = window as unknown as Window;
  (globalThis as { document?: Document }).document = window.document;
  (globalThis as { localStorage?: Storage }).localStorage = window.localStorage;
  window.TandoorRf = {
    apiRequest: async () => ({ response: { status: 200 }, data: {} }),
    extractErrorMessage: () => "",
    mapRequestError: () => "",
    REQUEST_TIMEOUT_MS: 10000,
  };

  delete require.cache[require.resolve("../../public/clients-shell.js")];
  delete require.cache[require.resolve("../../public/client-detail-sections.js")];
  const shell = require("../../public/clients-shell.js") as ShellModule;
  const sections = require("../../public/client-detail-sections.js") as SectionsModule;
  return { dom, window, shell, sections };
}

function mountShellDom(shell: ShellModule, active: "clients" | "profile", showClients: boolean) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body class="legacy-body">
      <div class="legacy-app">
        <div id="workspace-sidebar"></div>
        <button type="button" class="legacy-backdrop" id="legacy-backdrop" hidden></button>
        <div class="legacy-frame"><div id="workspace-topbar"></div></div>
      </div>
    </body></html>`,
    { url: "http://localhost/clients" },
  );
  const { window } = dom;
  (globalThis as { window?: Window }).window = window as unknown as Window;
  (globalThis as { document?: Document }).document = window.document;
  (globalThis as { localStorage?: Storage }).localStorage = window.localStorage;
  window.TandoorRf = {
    apiRequest: async () => ({ response: { status: 200 }, data: {} }),
    extractErrorMessage: () => "",
    mapRequestError: () => "",
    REQUEST_TIMEOUT_MS: 10000,
  };

  shell.mountShell(active, { showClients });
  return { dom, document: window.document };
}

function clearStorage() {
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
}

describe("legacy shell DOM", () => {
  beforeEach(() => {
    clearStorage();
  });

  afterEach(() => {
    clearStorage();
  });

  it("renders sidebar navigation for admin clients workspace", () => {
    const { shell } = loadBrowserModules();
    const { document } = mountShellDom(shell, "clients", true);
    assert.ok(document.querySelector('a[href="/clients"]'));
    assert.ok(document.querySelector('a[href="/profile"]'));
    assert.ok(document.getElementById("legacy-logout"));
    assert.ok(document.querySelector("[data-theme-toggle]"));
  });

  it("hides clients link for non-admin profile shell", () => {
    const { shell } = loadBrowserModules();
    const { document } = mountShellDom(shell, "profile", false);
    const navLinks = Array.from(document.querySelectorAll(".legacy-sidebar__nav a"));
    assert.equal(navLinks.length, 1);
    assert.equal(navLinks[0]?.getAttribute("href"), "/profile");
  });

  it("toggles theme via data-theme on documentElement", () => {
    const { dom, shell } = loadBrowserModules();
    shell.applyTheme("light");
    assert.equal(dom.window.document.documentElement.getAttribute("data-theme"), "light");
    shell.toggleTheme();
    assert.equal(dom.window.document.documentElement.getAttribute("data-theme"), "dark");
    assert.equal(shell.readTheme(), "dark");
  });

  it("opens and closes mobile menu with backdrop and aria-expanded", () => {
    const { shell } = loadBrowserModules();
    const { document } = mountShellDom(shell, "clients", true);
    const toggle = document.getElementById("legacy-menu-toggle") as HTMLButtonElement;
    const sidebar = document.getElementById("legacy-sidebar") as HTMLElement;
    const backdrop = document.getElementById("legacy-backdrop") as HTMLButtonElement;

    toggle.click();
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.ok(sidebar.classList.contains("is-open"));
    assert.equal(backdrop.hidden, false);

    shell.setMobileMenuOpen(false);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(backdrop.hidden, true);
  });
});

describe("client detail sections DOM", () => {
  it("renders pending notice once per unconnected block, not per label row", () => {
    const { sections } = loadBrowserModules();
    const html = sections.renderAllSections("?return=%3Fq%3Dtest");
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    const { document } = dom.window;

    const notices = document.querySelectorAll(".legacy-pending-block__notice");
    assert.ok(notices.length >= 2);
    notices.forEach((node) => {
      assert.equal(node.textContent, sections.PENDING_NOTICE);
    });

    const requisites = document.querySelector('[data-testid="section-requisites"]');
    assert.ok(requisites);
    sections.REQUISITES_LABELS.forEach((label) => {
      assert.ok(requisites?.textContent?.includes(label));
    });
  });

  it("initializes collapsible sections with aria-expanded on summary", () => {
    const { sections } = loadBrowserModules();
    const html = sections.renderAllSections("");
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    const { document } = dom.window;
    const root = document.getElementById("client-detail-sections");
    assert.ok(root);
    sections.initCollapsibles(root);
    const summaries = root.querySelectorAll(".legacy-details__summary");
    assert.ok(summaries.length >= 2);
    summaries.forEach((summary) => {
      assert.ok(
        summary.getAttribute("aria-expanded") === "true" ||
          summary.getAttribute("aria-expanded") === "false",
      );
    });
  });

  it("shows honest stores message without fake rows", () => {
    const { sections } = loadBrowserModules();
    const html = sections.renderAllSections("");
    assert.match(html, /Торговые точки ещё не подключены/);
    assert.doesNotMatch(html, /stores_count|0%/);
  });
});
