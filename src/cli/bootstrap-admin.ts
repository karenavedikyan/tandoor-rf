import { createInterface } from "readline/promises";
import type { Interface } from "readline/promises";
import { Pool } from "pg";
import { getDatabaseUrl, getPgSslConfig } from "../config";
import { hashPassword, validatePasswordInput } from "../auth/password";
import { normalizeEmail } from "../validation/email";
import { normalizeFullName } from "../validation/profile";

const BOOTSTRAP_LOCK_KEY = 902_451_002;

function createPrompt(): Interface {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askLine(rl: Interface, label: string): Promise<string> {
  const answer = await rl.question(label);
  return answer.trim();
}

async function askHidden(label: string): Promise<string> {
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("Interactive password input requires a TTY."));
      return;
    }

    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let password = "";
    const onData = (chunk: string): void => {
      switch (chunk) {
        case "\n":
        case "\r":
        case "\u0004":
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(password);
          break;
        case "\u0003":
          process.stdout.write("\n");
          process.exit(130);
          break;
        case "\u007f":
          password = password.slice(0, -1);
          break;
        default:
          if (chunk >= " " || chunk > "\u007f") {
            password += chunk;
          }
          break;
      }
    };

    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const rl = createPrompt();
  try {
    const fullNameRaw = await askLine(rl, "ФИО администратора: ");
    const emailRaw = await askLine(rl, "Email администратора: ");

    const fullName = normalizeFullName(fullNameRaw);
    const email = normalizeEmail(emailRaw);
    if (!fullName) {
      throw new Error("ФИО должно содержать от 2 до 200 символов.");
    }
    if (!email) {
      throw new Error("Укажите корректный email.");
    }

    const password = await askHidden("Пароль администратора (ввод скрыт): ");
    rl.close();
    const passwordCheck = validatePasswordInput(password);
    if (!passwordCheck.ok) {
      throw new Error(passwordCheck.message);
    }

    const ssl = getPgSslConfig();
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      ssl: ssl === false ? false : ssl,
    });
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [BOOTSTRAP_LOCK_KEY],
      );
      if (!lock.rows[0]?.locked) {
        throw new Error("Another bootstrap process is already running.");
      }

      const adminExists = await client.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1 FROM users WHERE role = 'admin'
          ) AS exists
        `,
      );
      if (adminExists.rows[0]?.exists) {
        throw new Error("Administrator already exists. Bootstrap refused.");
      }

      const emailExists = await client.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1 FROM users WHERE LOWER(BTRIM(email)) = $1
          ) AS exists
        `,
        [email],
      );
      if (emailExists.rows[0]?.exists) {
        throw new Error("User with this email already exists. Bootstrap refused.");
      }

      const passwordHash = await hashPassword(password);
      await client.query(
        `
          INSERT INTO users (email, password_hash, full_name, role, status)
          VALUES ($1, $2, $3, 'admin', 'active')
        `,
        [email, passwordHash, fullName],
      );

      await client.query("SELECT pg_advisory_unlock($1)", [BOOTSTRAP_LOCK_KEY]);
      await client.query("COMMIT");
      console.log("Administrator created successfully.");
    } catch (error) {
      await client.query("ROLLBACK");
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [BOOTSTRAP_LOCK_KEY]);
      } catch {
        // ignore
      }
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Bootstrap failed: ${message}`);
  process.exit(1);
});
