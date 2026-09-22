import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export const DUMMY_PASSWORD_HASH =
  "$2a$12$/g43dytYJXdqtLpBn3CJve9oz3PzrrS76G2.TjhckwgVlTzw/h61G";

export function passwordByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function validatePasswordInput(
  password: string,
): { ok: true } | { ok: false; message: string } {
  if (password.length < 12) {
    return {
      ok: false,
      message: "Пароль должен содержать не менее 12 символов.",
    };
  }
  if (passwordByteLength(password) > 72) {
    return {
      ok: false,
      message: "Пароль не должен превышать 72 байта в UTF-8.",
    };
  }
  return { ok: true };
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
