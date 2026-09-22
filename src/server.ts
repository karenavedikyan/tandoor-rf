import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { loginHandler, logoutHandler, meHandler } from "./auth/handlers";
import { JSON_BODY_LIMIT } from "./config";
import { checkReadiness } from "./db/readiness";
import { closePool } from "./db/pool";
import { setNoStore } from "./http/no-store";
import { requireAuth } from "./middleware/auth";
import { csrfProtection } from "./middleware/csrf";
import { requireDatabaseReady } from "./middleware/database";
import { getSelfProfileHandler, patchSelfProfileHandler } from "./profile/handlers";
import { apiError, ERROR_CODES } from "./shared/errors";

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

function sendHtmlPage(res: Response, publicDir: string, filename: string): void {
  setNoStore(res);
  res.sendFile(path.join(publicDir, filename));
}

async function readyHandler(_req: Request, res: Response): Promise<void> {
  const readiness = await checkReadiness();
  setNoStore(res);
  if (!readiness.ready) {
    res.status(503).json({
      status: "not_ready",
      reason: readiness.reason,
    });
    return;
  }
  res.status(200).json({ status: "ready" });
}

export function createApp(): express.Application {
  const app = express();
  const publicDir = resolvePublicDir();

  app.get("/api/health", (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    res.status(200).json(HEALTH_BODY);
  });

  app.get("/api/ready", (req, res, next) => {
    void readyHandler(req, res).catch(next);
  });

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const authRouter = express.Router();
  authRouter.post(
    "/login",
    csrfProtection,
    requireDatabaseReady,
    (req, res, next) => {
      void loginHandler(req, res).catch(next);
    },
  );
  authRouter.post(
    "/logout",
    csrfProtection,
    requireDatabaseReady,
    (req, res, next) => {
      void logoutHandler(req, res).catch(next);
    },
  );
  authRouter.get(
    "/me",
    requireDatabaseReady,
    requireAuth,
    (req, res, next) => {
      void meHandler(req, res).catch(next);
    },
  );

  const profileRouter = express.Router();
  profileRouter.get(
    "/self",
    requireDatabaseReady,
    requireAuth,
    (req, res, next) => {
      void getSelfProfileHandler(req, res).catch(next);
    },
  );
  profileRouter.patch(
    "/self",
    csrfProtection,
    requireDatabaseReady,
    requireAuth,
    (req, res, next) => {
      void patchSelfProfileHandler(req, res).catch(next);
    },
  );

  app.use("/api/auth", authRouter);
  app.use("/api/profile", profileRouter);

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(express.static(publicDir));

  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.get("/login", (_req: Request, res: Response) => {
    sendHtmlPage(res, publicDir, "login.html");
  });

  app.get("/profile", (_req: Request, res: Response) => {
    sendHtmlPage(res, publicDir, "profile.html");
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
        if (status >= 500) {
          setNoStore(res);
          res.status(status).json(
            apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Внутренняя ошибка сервера."),
          );
          return;
        }
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
      void closePool()
        .catch(() => undefined)
        .finally(() => {
          console.log("HTTP server closed.");
          process.exit(0);
        });
    });
  });

  return server;
}

if (require.main === module) {
  startServer();
}
