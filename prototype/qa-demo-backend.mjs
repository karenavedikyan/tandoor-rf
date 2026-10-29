import { spawn } from "child_process";
import net from "net";
import { fileURLToPath } from "url";
import { join } from "path";

const PORT = 34113;
const HOST = "127.0.0.1";
const root = join(fileURLToPath(import.meta.url), "..", "..");

export function waitForPort(port, host = HOST, attempts = 80) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tryOnce = () => {
      const socket = net.connect(port, host, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        if (++n >= attempts) reject(new Error(`port ${port} not ready`));
        else setTimeout(tryOnce, 100);
      });
    };
    tryOnce();
  });
}

export function portOpen(port, host = HOST) {
  return new Promise((resolve) => {
    const socket = net.connect(port, host, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

/** Reuse a healthy demo backend on :34113; start one only if missing. */
export async function ensureDemoBackend() {
  if (await portOpen(PORT)) {
    return { proc: null, owned: false };
  }
  const proc = spawn("node", ["prototype/notification-demo-server.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.on("exit", (code) => {
    if (code && code !== 0) console.error("notification demo backend exited", code);
  });
  await waitForPort(PORT);
  return { proc, owned: true };
}

export function releaseDemoBackend(handle) {
  if (handle?.owned && handle?.proc && !handle.proc.killed) {
    handle.proc.kill("SIGTERM");
  }
}
