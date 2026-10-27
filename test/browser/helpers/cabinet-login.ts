import type { Page } from "playwright";

/** Post-login landing: clients, admin access, assignments, work, or legacy profile. */
export async function loginCabinet(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("#login-button");
  await page.waitForURL(/\/(clients|admin\/access|access|work|profile)(\/|\?|$)/, { timeout: 20000 });
  await page.waitForLoadState("domcontentloaded");
}

export async function waitClientsShellReady(page: Page): Promise<void> {
  await page.locator("#legacy-topbar").waitFor({ state: "visible", timeout: 20000 });
}
