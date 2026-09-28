import fs from "fs";
import http from "http";
import path from "path";
import { chromium } from "playwright";
import { createApp } from "../dist/server.js";

const OUT_DIR =
  process.argv[2] ??
  "/cursor/stores/bc-01a0c95b-ccc6-786a-8dc8-f91f60a1cd82/media";

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            role: "admin",
            email: "admin@synthetic.test",
            fullName: "Synthetic Admin",
          },
        }),
      });
      return;
    }
    if (url.pathname === "/api/admin/access/overview") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          users: [{ id: "u1", email: "manager-a@test", role: "manager", status: "active" }],
          links: [
            {
              id: "l1",
              user_email: "manager-a@test",
              employee_id: "22222222-2222-4222-8222-222222222222",
              basis: "pilot setup",
            },
          ],
          grants: [],
          teams: [],
          coordinatorTeams: [],
          delegations: [],
          audit: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: '{"error":"not mocked"}',
    });
  });

  await page.goto(`${baseUrl}/admin/access`);
  await page.waitForSelector("#admin-access-app:not(.clients-hidden)");
  await page.screenshot({
    path: path.join(OUT_DIR, "r13-admin-access-overview-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/admin/access`);
  await page.waitForSelector("#admin-access-app:not(.clients-hidden)");
  await page.screenshot({
    path: path.join(OUT_DIR, "r13-admin-access-overview-mobile.png"),
    fullPage: true,
  });

  await browser.close();
  server.close();
  console.log("Saved screenshots to", OUT_DIR);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
