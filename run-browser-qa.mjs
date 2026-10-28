import { chromium } from "playwright";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const root = join(fileURLToPath(import.meta.url), "..", "site");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf" };

const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\//, "") || "index.html");
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(4317, "127.0.0.1", r));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));
globalThis.page = page;

const script = process.argv[2];
if (!script) throw new Error("usage: node run-browser-qa.mjs <qa.js>");
const { pathToFileURL } = await import("url");
await import(pathToFileURL(join(process.cwd(), script)).href);

await browser.close();
server.close();
