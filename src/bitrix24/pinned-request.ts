import https from "node:https";
import type { ResolvedPortalAddress } from "./dns-resolve";

export type PinnedRequestOptions = {
  url: URL;
  pinned: ResolvedPortalAddress;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
};

export type PinnedRequestResult = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export type PinnedRequestFn = (options: PinnedRequestOptions) => Promise<PinnedRequestResult>;

export async function executePinnedHttpsRequest(
  options: PinnedRequestOptions,
): Promise<PinnedRequestResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      handler();
    };

    const req = https.request(
      {
        host: options.pinned.address,
        port: options.url.port ? Number(options.url.port) : 443,
        path: `${options.url.pathname}${options.url.search}`,
        method: options.method,
        headers: {
          ...options.headers,
          Host: options.url.hostname,
        },
        servername: options.url.hostname,
        rejectUnauthorized: true,
        family: options.pinned.family,
        lookup: (_hostname, _lookupOptions, callback) => {
          callback(null, options.pinned.address, options.pinned.family);
        },
      },
      (res) => {
        if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          finish(() => reject(new Error("REDIRECT_BLOCKED")));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;

        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxResponseBytes) {
            req.destroy();
            res.destroy();
            finish(() => reject(new Error("RESPONSE_TOO_LARGE")));
            return;
          }
          chunks.push(chunk);
        });

        res.on("error", (error) => {
          finish(() => reject(error));
        });

        res.on("end", () => {
          finish(() =>
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        });
      },
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish(() => reject(new Error("TIMEOUT")));
    }, options.timeoutMs);

    const onAbort = () => {
      req.destroy();
      finish(() => reject(new Error("ABORTED")));
    };
    options.signal?.addEventListener("abort", onAbort);

    req.on("error", (error) => {
      finish(() => reject(error));
    });

    req.write(options.body);
    req.end();
  });
}
