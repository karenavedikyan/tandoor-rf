import { MAX_EMAIL_LENGTH } from "../config";

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !SIMPLE_EMAIL_RE.test(email)) {
    return null;
  }
  return email;
}
