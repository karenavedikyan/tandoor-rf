import net from "node:net";

export type PgTcpProxyMode = "drop_commit_response" | "drop_before_commit";

const COMMIT_MARKER = Buffer.from("COMMIT");

export type PgTcpProxyStats = {
  commitsObserved: number;
  commitsForwarded: number;
  commitResponsesDropped: number;
  commitsBlocked: number;
};

export type PgTcpProxy = {
  port: number;
  stats: PgTcpProxyStats;
  close: () => Promise<void>;
};

function parseDatabaseEndpoint(databaseUrl: string): { host: string; port: number } {
  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
  };
}

export function buildProxiedDatabaseUrl(databaseUrl: string, proxyPort: number): string {
  const parsed = new URL(databaseUrl);
  parsed.hostname = "127.0.0.1";
  parsed.port = String(proxyPort);
  return parsed.toString();
}

export async function startPgTcpProxy(
  databaseUrl: string,
  mode: PgTcpProxyMode,
): Promise<PgTcpProxy> {
  const target = parseDatabaseEndpoint(databaseUrl);
  const stats: PgTcpProxyStats = {
    commitsObserved: 0,
    commitsForwarded: 0,
    commitResponsesDropped: 0,
    commitsBlocked: 0,
  };

  const server = net.createServer((clientSocket) => {
    const serverSocket = net.connect({ host: target.host, port: target.port });
    let clientBuffer = Buffer.alloc(0);
    let commitForwarded = false;
    let droppingCommitResponse = false;

    const destroyBoth = () => {
      clientSocket.destroy();
      serverSocket.destroy();
    };

    clientSocket.on("data", (chunk) => {
      if (chunk.includes(COMMIT_MARKER)) {
        stats.commitsObserved += 1;
      }

      if (mode === "drop_before_commit") {
        clientBuffer = Buffer.concat([clientBuffer, chunk]);
        const commitIndex = clientBuffer.indexOf(COMMIT_MARKER);
        if (commitIndex === -1) {
          serverSocket.write(chunk);
          return;
        }
        stats.commitsBlocked += 1;
        const beforeCommit = clientBuffer.subarray(0, commitIndex);
        if (beforeCommit.length > 0) {
          serverSocket.write(beforeCommit);
        }
        destroyBoth();
        return;
      }

      serverSocket.write(chunk);
      if (chunk.includes(COMMIT_MARKER)) {
        commitForwarded = true;
        stats.commitsForwarded += 1;
      }
    });

    serverSocket.on("data", (chunk) => {
      if (mode === "drop_commit_response" && (commitForwarded || droppingCommitResponse)) {
        droppingCommitResponse = true;
        stats.commitResponsesDropped += 1;
        clientSocket.destroy();
        return;
      }
      clientSocket.write(chunk);
    });

    clientSocket.on("error", destroyBoth);
    serverSocket.on("error", destroyBoth);
    clientSocket.on("close", () => serverSocket.destroy());
    serverSocket.on("close", () => clientSocket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind PostgreSQL TCP proxy.");
  }

  return {
    port: address.port,
    stats,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
