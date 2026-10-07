import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Pool } from "pg";
import { createPgPoolOptions } from "../config/pg-ssl";
import { getDatabaseUrl } from "../config";
import {
  grantAdminAccess,
  inspectUserByEmail,
  type GrantAdminAccessResult,
  type UserInspectResult,
} from "../access/user-provisioning";

type CliArgs = {
  command: "inspect" | "grant";
  email: string;
  fullName?: string;
  actorUserId?: string;
  basis?: string;
  confirmAuditReviewed?: boolean;
  assignAdminRoleOnly?: boolean;
  passwordDelivery?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const command = positional[0];
  if (command !== "inspect" && command !== "grant") {
    throw new Error(
      "Usage: grant-admin-access inspect --email <email>\n" +
        "       grant-admin-access grant --email <email> --full-name <name> --actor-user-id <uuid> --basis <text> --confirm-audit-reviewed [--assign-admin-role] [--password-delivery file:<path>]",
    );
  }

  const readFlag = (name: string): string | undefined => {
    const withEq = argv.find((arg) => arg.startsWith(`${name}=`));
    if (withEq) {
      return withEq.slice(name.length + 1);
    }
    const index = argv.indexOf(name);
    if (index >= 0) {
      return argv[index + 1];
    }
    return undefined;
  };

  const email = readFlag("--email");
  if (!email) {
    throw new Error("--email is required.");
  }

  return {
    command,
    email,
    fullName: readFlag("--full-name"),
    actorUserId: readFlag("--actor-user-id"),
    basis: readFlag("--basis"),
    confirmAuditReviewed: argv.includes("--confirm-audit-reviewed"),
    assignAdminRoleOnly: argv.includes("--assign-admin-role"),
    passwordDelivery: readFlag("--password-delivery"),
  };
}

function printInspect(result: UserInspectResult): void {
  console.log(JSON.stringify(result, null, 2));
  if (result.employeeLinks.length > 0) {
    console.error(
      "WARN: у пользователя есть привязки к сотрудникам 1С; новая выдача admin не создаёт и не меняет их.",
    );
  }
}

async function deliverTemporaryPassword(
  password: string,
  delivery: string | undefined,
): Promise<void> {
  if (delivery?.startsWith("file:")) {
    const targetPath = delivery.slice("file:".length);
    if (!targetPath) {
      throw new Error("--password-delivery file:<path> requires a path.");
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(
      targetPath,
      [
        "# Временный пароль ЛК Tandoor (одноразовая выдача)",
        "# Пер передайте получателю по защищённому каналу и удалите файл.",
        password,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
    console.log(`Temporary password written to ${targetPath} (mode 0600).`);
    return;
  }

  if (!process.stdout.isTTY) {
    throw new Error(
      "Refusing to print temporary password to non-TTY stdout. Use --password-delivery file:<path>.",
    );
  }

  console.log("---");
  console.log("Временный пароль (показывается один раз; не логируйте и не коммитьте):");
  console.log(password);
  console.log("---");
  console.log("Передайте пароль получателю по защищённому каналу. Смена обязательна при первом входе.");
}

function printGrantResult(result: GrantAdminAccessResult): void {
  if (!result.ok) {
    console.error(JSON.stringify({ status: "refused", ...result }));
    process.exitCode = 1;
    return;
  }

  if (result.mode === "role_assigned") {
    console.log(
      JSON.stringify({
        status: "ok",
        mode: result.mode,
        userId: result.userId,
        email: result.email,
        passwordChanged: false,
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      status: "ok",
      mode: result.mode,
      userId: result.userId,
      email: result.email,
      passwordChanged: true,
      passwordDelivery: "see separate channel",
    }),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const pgOptions = createPgPoolOptions(databaseUrl);
  const pool = new Pool({
    connectionString: pgOptions.connectionString,
    max: 1,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
  });
  const client = await pool.connect();

  try {
    if (args.command === "inspect") {
      printInspect(await inspectUserByEmail(client, args.email));
      return;
    }

    if (!args.fullName || !args.actorUserId || !args.basis) {
      throw new Error("grant requires --full-name, --actor-user-id and --basis.");
    }

    await client.query("BEGIN");
    const result = await grantAdminAccess(client, {
      email: args.email,
      fullName: args.fullName,
      actorUserId: args.actorUserId,
      basis: args.basis,
      auditReviewConfirmed: args.confirmAuditReviewed === true,
      assignAdminRoleOnly: args.assignAdminRoleOnly,
    });

    if (!result.ok) {
      await client.query("ROLLBACK");
      printGrantResult(result);
      return;
    }

    await client.query("COMMIT");

    if (result.mode === "created") {
      await deliverTemporaryPassword(result.temporaryPassword, args.passwordDelivery);
    }

    printGrantResult(result);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`grant-admin-access failed: ${message}`);
  process.exit(1);
});
