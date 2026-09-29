import https from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
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

export type HttpsRequestFn = typeof https.request;

let httpsRequestImpl: HttpsRequestFn = https.request;

export function setHttpsRequestImplForTests(impl: HttpsRequestFn | null): void {
  httpsRequestImpl = impl ?? https.request;
}

export async function executePinnedHttpsRequest(
  options: PinnedRequestOptions,
): Promise<PinnedRequestResult> {
  if (options.signal?.aborted) {
    throw new Error("ABORTED");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let req: ClientRequest | null = null;
    let res: IncomingMessage | null = null;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      options.signal?.removeEventListener("abort", onAbort);
    };

    const destroyStreams = () => {
      if (req && !req.destroyed) {
        req.destroy();
      }
      if (res && !res.destroyed) {
        res.destroy();
      }
    };

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      destroyStreams();
      handler();
    };

    const onAbort = () => {
      finish(() => reject(new Error("ABORTED")));
    };
    options.signal?.addEventListener("abort", onAbort);

    timer = setTimeout(() => {
      finish(() => reject(new Error("TIMEOUT")));
    }, options.timeoutMs);

    req = httpsRequestImpl(
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
      (response) => {
        res = response;

        if (response.statusCode !== undefined && response.statusCode >= 300 && response.statusCode < 400) {
          finish(() => reject(new Error("REDIRECT_BLOCKED")));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;

        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxResponseBytes) {
            finish(() => reject(new Error("RESPONSE_TOO_LARGE")));
            return;
          }
          chunks.push(chunk);
        });

        response.on("error", (error) => {
          finish(() => reject(error));
        });

        response.on("end", () => {
          finish(() =>
            resolve({
              statusCode: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        });
      },
    );

    req.on("error", (error) => {
      finish(() => reject(error));
    });

    req.write(options.body);
    req.end();
  });
}
