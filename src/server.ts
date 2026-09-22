import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";

const HEALTH_BODY = { status: "ok", app: "tandoor-rf" } as const;

const SAFE_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  400: "Bad request",
  404: "Not found",
  416: "Range not satisfiable",
  500: "Internal server error",
};

function getErrorStatus(err: unknown): number {
  if (err !== null && typeof err === "object") {
    const candidate = err as { status?: unknown; statusCode?: unknown };
    const status =
      typeof candidate.status === "number"
        ? candidate.status
        : typeof candidate.statusCode === "number"
          ? candidate.statusCode
          : undefined;

    if (typeof status === "number" && status >= 400 && status < 600) {
      return status;
    }
  }

  return 500;
}

function getSafeErrorMessage(status: number): string {
  return SAFE_ERROR_MESSAGES[status] ?? "An error occurred";
}

function isApiRequest(req: Request): boolean {
  return req.path.startsWith("/api");
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(
      `Invalid PORT: "${value}". Must be an integer between 1 and 65535.`,
    );
    process.exit(1);
  }

  return port;
}

function resolvePublicDir(): string {
  const bundledPublic = path.join(__dirname, "public");
  if (fs.existsSync(bundledPublic)) {
    return bundledPublic;
  }
  return path.join(__dirname, "..", "public");
}

export function createApp(): express.Application {
  const app = express();
  const publicDir = resolvePublicDir();

  app.get("/api/health", (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    res.status(200).json(HEALTH_BODY);
  });

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(express.static(publicDir));

  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.use(
    (err: unknown, req: Request, res: Response, next: NextFunction): void => {
      if (res.headersSent) {
        next(err);
        return;
      }

      const status = getErrorStatus(err);

      if (status >= 500) {
        console.error(`Server error (${status}) ${req.method} ${req.path}`);
      }

      if (isApiRequest(req)) {
        res.status(status).json({ error: getSafeErrorMessage(status) });
        return;
      }

      res.status(status).type("text/plain").send(getSafeErrorMessage(status));
    },
  );

  return app;
}

export function startServer(): ReturnType<express.Application["listen"]> {
  const port = parsePort(process.env.PORT);
  const app = createApp();

  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on 0.0.0.0:${port}`);
  });

  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down gracefully...");
    server.close(() => {
      console.log("HTTP server closed.");
      process.exit(0);
    });
  });

  return server;
}

if (require.main === module) {
  startServer();
}
