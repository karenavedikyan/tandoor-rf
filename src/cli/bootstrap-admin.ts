import { Pool } from "pg";
import { askHidden, askLine } from "./hidden-input";
import { createPgPoolOptions } from "../config/pg-ssl";
import { getDatabaseUrl } from "../config";
import { hashPassword, validatePasswordInput } from "../auth/password";
import { normalizeEmail } from "../validation/email";
import { normalizeFullName } from "../validation/profile";

const BOOTSTRAP_LOCK_KEY = 902_451_002;

async function main(): Promise<void> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const fullNameRaw = await askLine("ФИО администратора: ");
  const emailRaw = await askLine("Email администратора: ");
  const password = await askHidden("Пароль администратора (ввод скрыт): ");

  const fullName = normalizeFullName(fullNameRaw);
  const email = normalizeEmail(emailRaw);
  if (!fullName) {
    throw new Error("ФИО должно содержать от 2 до 200 символов.");
  }
  if (!email) {
    throw new Error("Укажите корректный email.");
  }

  const passwordCheck = validatePasswordInput(password);
  if (!passwordCheck.ok) {
    throw new Error(passwordCheck.message);
  }

  const pgOptions = createPgPoolOptions(databaseUrl);
  const pool = new Pool({
    connectionString: pgOptions.connectionString,
    max: 1,
    ssl: pgOptions.ssl === false ? false : pgOptions.ssl,
  });
  const client = await pool.connect();
  let lockHeld = false;

  try {
    await client.query("BEGIN");
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [BOOTSTRAP_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      throw new Error("Another bootstrap process is already running.");
    }
    lockHeld = true;

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

    await client.query("COMMIT");
    lockHeld = false;
    await client.query("SELECT pg_advisory_unlock($1)", [BOOTSTRAP_LOCK_KEY]);
    console.log("Administrator created successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    if (lockHeld) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [BOOTSTRAP_LOCK_KEY]);
      } catch {
        // ignore
      }
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Bootstrap failed: ${message}`);
  process.exit(1);
});
