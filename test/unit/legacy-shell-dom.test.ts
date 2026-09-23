import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);

type ShellModule = {
  mountShell: (active: string, options?: { showClients?: boolean }) => void;
  applyTheme: (theme: "light" | "dark") => void;
  readTheme: () => "light" | "dark";
  toggleTheme: () => void;
  setMobileMenuOpen: (open: boolean, options?: { skipFocus?: boolean }) => void;
  syncSidebarLayout: () => void;
  isDesktopViewport: () => boolean;
  readSidebarCollapsed: () => boolean;
  writeSidebarCollapsed: (collapsed: boolean) => void;
};

type SectionsModule = {
  renderAllSections: (returnQuery: string) => string;
  initCollapsibles: (root: ParentNode) => void;
  countCollapsibleListeners: (root: ParentNode) => number;
  PENDING_NOTICE: string;
  REQUISITES_LABELS: string[];
};

const uncaughtErrors: unknown[] = [];
const originalListeners = process.listeners("uncaughtException");

function installErrorGuards() {
  uncaughtErrors.length = 0;
  process.removeAllListeners("uncaughtException");
  process.on("uncaughtException", (error) => {
    uncaughtErrors.push(error);
    throw error;
  });
}

function restoreErrorGuards() {
  process.removeAllListeners("uncaughtException");
  for (const listener of originalListeners) {
    process.on("uncaughtException", listener as NodeJS.UncaughtExceptionListener);
  }
}

function clearStorage() {
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
}

function installMatchMedia(window: Window, desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes("1024"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function loadBrowserModules(desktop = true) {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/clients",
  });
  const { window } = dom;
  (globalThis as { window?: Window }).window = window as unknown as Window;
  (globalThis as { document?: Document }).document = window.document;
  (globalThis as { localStorage?: Storage }).localStorage = window.localStorage;
  installMatchMedia(window, desktop);
  window.TandoorRf = {
    apiRequest: async () => ({ response: { status: 200 }, data: {} }),
    extractErrorMessage: () => "",
    mapRequestError: () => "",
    REQUEST_TIMEOUT_MS: 10000,
  };

  delete require.cache[require.resolve("../../public/brand/shell-icons.js")];
  delete require.cache[require.resolve("../../public/clients-shell.js")];
  delete require.cache[require.resolve("../../public/client-detail-sections.js")];
  require("../../public/brand/shell-icons.js");
  const shell = require("../../public/clients-shell.js") as ShellModule;
  const sections = require("../../public/client-detail-sections.js") as SectionsModule;
  return { dom, window, shell, sections };
}

function mountShellDom(shell: ShellModule, desktop: boolean, showClients = true) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body class="legacy-body">
      <div class="legacy-app">
        <div id="workspace-sidebar"></div>
        <button type="button" class="legacy-backdrop" id="legacy-backdrop" hidden></button>
        <div class="legacy-frame"><div id="workspace-topbar"></div><main><button id="outside">Outside</button></main></div>
      </div>
    </body></html>`,
    { url: "http://localhost/clients" },
  );
  const { window } = dom;
  (globalThis as { window?: Window }).window = window as unknown as Window;
  (globalThis as { document?: Document }).document = window.document;
  (globalThis as { localStorage?: Storage }).localStorage = window.localStorage;
  installMatchMedia(window, desktop);
  window.TandoorRf = {
    apiRequest: async () => ({ response: { status: 200 }, data: {} }),
    extractErrorMessage: () => "",
    mapRequestError: () => "",
    REQUEST_TIMEOUT_MS: 10000,
  };
  require("../../public/brand/shell-icons.js");
  shell.mountShell("clients", { showClients });
  return { dom, document: window.document, window };
}

function activeElementTag(doc: Document): string {
  const el = doc.activeElement;
  return el ? `${el.tagName}#${el.id || el.className}` : "none";
}

function collapseBtnHiddenOnMobile(document: Document): boolean {
  const collapseBtn = document.getElementById("legacy-sidebar-collapse") as HTMLButtonElement | null;
  return collapseBtn?.hidden ?? false;
}

describe("legacy shell DOM", () => {
  beforeEach(() => {
    clearStorage();
    installErrorGuards();
  });

  afterEach(() => {
    clearStorage();
    restoreErrorGuards();
    assert.equal(uncaughtErrors.length, 0, `uncaught errors: ${String(uncaughtErrors[0])}`);
  });

  it("renders sidebar navigation with SVG icons for admin workspace", () => {
    const { shell } = loadBrowserModules(true);
    const { document } = mountShellDom(shell, true, true);
    assert.ok(document.querySelector('a[href="/clients"] svg.legacy-icon'));
    assert.ok(document.querySelector('a[href="/profile"] svg.legacy-icon'));
    assert.ok(document.getElementById("legacy-logout"));
    assert.doesNotMatch(document.body.innerHTML, /👥|👤|⎋/);
  });

  it("hides clients link for non-admin profile shell", () => {
    const { shell } = loadBrowserModules(true);
    const { document } = mountShellDom(shell, true, false);
    const navLinks = Array.from(document.querySelectorAll(".legacy-sidebar__nav a"));
    assert.equal(navLinks.length, 1);
    assert.equal(navLinks[0]?.getAttribute("href"), "/profile");
  });

  it("toggles theme via data-theme on documentElement", () => {
    const { dom, shell } = loadBrowserModules(true);
    shell.applyTheme("light");
    assert.equal(dom.window.document.documentElement.getAttribute("data-theme"), "light");
    shell.toggleTheme();
    assert.equal(dom.window.document.documentElement.getAttribute("data-theme"), "dark");
    assert.equal(shell.readTheme(), "dark");
  });

  it("opens mobile drawer via button, focuses first item, closes on Escape with focus return", () => {
    const { shell } = loadBrowserModules(false);
    const { document, window } = mountShellDom(shell, false, true);
    const toggle = document.getElementById("legacy-menu-toggle") as HTMLButtonElement;
    const sidebar = document.getElementById("legacy-sidebar") as HTMLElement;

    toggle.focus();
    toggle.click();

    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.ok(sidebar.classList.contains("is-open"));
    assert.equal(sidebar.getAttribute("aria-hidden"), null);

    const firstNav = sidebar.querySelector(".legacy-sidebar__nav .legacy-nav-link") as HTMLElement;
    assert.ok(firstNav);
    assert.equal(document.activeElement, firstNav, activeElementTag(document));

    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, toggle);
    assert.equal(sidebar.getAttribute("aria-hidden"), "true");
  });

  it("closes mobile drawer on backdrop click and returns focus to toggle", () => {
    const { shell } = loadBrowserModules(false);
    const { document } = mountShellDom(shell, false, true);
    const toggle = document.getElementById("legacy-menu-toggle") as HTMLButtonElement;
    const backdrop = document.getElementById("legacy-backdrop") as HTMLButtonElement;

    toggle.click();
    backdrop.click();

    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, toggle);
  });

  it("traps Tab and Shift+Tab within open mobile drawer", () => {
    const { shell } = loadBrowserModules(false);
    const { document, window } = mountShellDom(shell, false, true);
    const toggle = document.getElementById("legacy-menu-toggle") as HTMLButtonElement;
    const sidebar = document.getElementById("legacy-sidebar") as HTMLElement;

    toggle.click();
    const focusables = Array.from(
      sidebar.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !(el as HTMLElement).hidden) as HTMLElement[];
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;

    last.focus();
    document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    assert.equal(document.activeElement, first);

    first.focus();
    document.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(document.activeElement, last);
  });

  it("keeps closed mobile sidebar out of Tab order", () => {
    const { shell } = loadBrowserModules(false);
    const { document, window } = mountShellDom(shell, false, true);
    const toggle = document.getElementById("legacy-menu-toggle") as HTMLButtonElement;
    const logout = document.getElementById("legacy-logout") as HTMLButtonElement;
    const sidebar = document.getElementById("legacy-sidebar") as HTMLElement;

    toggle.focus();
    assert.equal(sidebar.getAttribute("aria-hidden"), "true");
    assert.equal(logout.getAttribute("tabindex"), "-1");

    window.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    assert.notEqual(document.activeElement, logout);
  });

  it("uses full mobile drawer after saved desktop collapsed preference", () => {
    const { shell } = loadBrowserModules(false);
    const { document, window } = mountShellDom(shell, false, true);
    window.localStorage.setItem("tandoor-rf-sidebar-collapsed", "true");
    shell.syncSidebarLayout();
    const sidebar = document.getElementById("legacy-sidebar") as HTMLElement;
    const app = document.querySelector(".legacy-app") as HTMLElement;
    const toggle = document.getElementById("legacy-menu-toggle") as HTMLButtonElement;

    assert.equal(app.classList.contains("sidebar-collapsed"), false);
    assert.equal(sidebar.classList.contains("is-collapsed"), false);

    toggle.click();
    assert.ok(sidebar.classList.contains("is-open"));
    const visibleText = sidebar.querySelector(".legacy-nav-link__text") as HTMLElement;
    assert.notEqual(visibleText.getAttribute("aria-hidden"), "true");
    assert.ok((visibleText.textContent || "").includes("Клиенты"));
    assert.ok(sidebar.querySelector(".legacy-sidebar__logo--full"));
  });

  it("applies desktop compact brand with triangle mark only on desktop", () => {
    const { shell } = loadBrowserModules(true);
    const { document, window } = mountShellDom(shell, true, true);
    window.localStorage.setItem("tandoor-rf-sidebar-collapsed", "true");
    shell.syncSidebarLayout();
    const app = document.querySelector(".legacy-app") as HTMLElement;
    const sidebar = document.getElementById("legacy-sidebar") as HTMLElement;

    assert.ok(app.classList.contains("sidebar-collapsed"));
    assert.ok(sidebar.classList.contains("is-collapsed"));
    const compactLogo = document.querySelector(".legacy-sidebar__logo--compact") as HTMLImageElement;
    const fullLogo = document.querySelector(".legacy-sidebar__logo--full") as HTMLImageElement;
    assert.ok(compactLogo);
    assert.ok(fullLogo);
    assert.match(compactLogo.getAttribute("src") || "", /tandoor-triangle-mark\.svg/);
    assert.equal(compactLogo.getAttribute("width"), "32");
    assert.equal(collapseBtnHiddenOnMobile(document), false);
  });

  it("syncs layout when switching from desktop collapsed to mobile", () => {
    const { shell } = loadBrowserModules(true);
    const { document, window } = mountShellDom(shell, true, true);
    window.localStorage.setItem("tandoor-rf-sidebar-collapsed", "true");
    shell.syncSidebarLayout();
    const app = document.querySelector(".legacy-app") as HTMLElement;
    assert.ok(app.classList.contains("sidebar-collapsed"));

    installMatchMedia(window, false);
    shell.syncSidebarLayout();

    const sidebar = document.getElementById("legacy-sidebar") as HTMLElement;
    assert.equal(app.classList.contains("sidebar-collapsed"), false);
    assert.equal(sidebar.classList.contains("is-collapsed"), false);
    assert.equal(sidebar.getAttribute("aria-hidden"), "true");
  });
});

describe("client detail sections DOM", () => {
  beforeEach(() => {
    installErrorGuards();
  });

  afterEach(() => {
    restoreErrorGuards();
    assert.equal(uncaughtErrors.length, 0);
  });

  it("renders pending notice once per unconnected block, not per label row", () => {
    const { sections } = loadBrowserModules(true);
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
    const { sections } = loadBrowserModules(true);
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

  it("does not multiply collapsible listeners on repeated init", () => {
    const { sections } = loadBrowserModules(true);
    const html = sections.renderAllSections("");
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
    const { document } = dom.window;
    const root = document.getElementById("client-detail-sections");
    assert.ok(root);
    sections.initCollapsibles(root);
    sections.initCollapsibles(root);
    sections.initCollapsibles(root);
    assert.equal(sections.countCollapsibleListeners(root), root.querySelectorAll(".legacy-details").length);
  });

  it("shows honest stores message without fake rows", () => {
    const { sections } = loadBrowserModules(true);
    const html = sections.renderAllSections("");
    assert.match(html, /Торговые точки ещё не подключены/);
    assert.doesNotMatch(html, /stores_count|0%/);
  });
});
