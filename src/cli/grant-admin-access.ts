import { Pool } from "pg";
import { createPgPoolOptions } from "../config/pg-ssl";
import { getDatabaseUrl } from "../config";
import {
  deliverTemporaryPasswordToChannel,
  parsePasswordDeliverySpec,
  verifyPasswordDeliveryChannel,
} from "../access/password-delivery";
import {
  grantAdminAccess,
  inspectUserByEmail,
  rollbackProvisionedAdminUser,
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

    const deliverySpec = args.assignAdminRoleOnly
      ? null
      : parsePasswordDeliverySpec(args.passwordDelivery);
    if (!args.assignAdminRoleOnly) {
      if (!deliverySpec) {
        throw new Error(
          "Password delivery channel is required for new accounts. Use --password-delivery file:<path> or an interactive TTY.",
        );
      }
      await verifyPasswordDeliveryChannel(deliverySpec);
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

    try {
      await client.query("COMMIT");
    } catch (commitError) {
      await client.query("ROLLBACK");
      throw commitError;
    }

    if (result.mode === "created") {
      try {
        await deliverTemporaryPasswordToChannel(result.temporaryPassword, deliverySpec!);
      } catch (deliveryError) {
        await client.query("BEGIN");
        await rollbackProvisionedAdminUser(client, {
          userId: result.userId,
          actorUserId: args.actorUserId!,
          basis: args.basis!,
          reason: "password delivery failed",
        });
        await client.query("COMMIT");
        throw deliveryError;
      }
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
