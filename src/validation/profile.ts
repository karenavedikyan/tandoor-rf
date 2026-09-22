const FULL_NAME_MIN = 2;
const FULL_NAME_MAX = 200;

export function normalizeFullName(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim();
  if (value.length < FULL_NAME_MIN || value.length > FULL_NAME_MAX) {
    return null;
  }
  return value;
}

export function normalizePhone(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const digits = trimmed.replace(/\D/g, "");
  let normalized: string | null = null;

  if (digits.length === 11 && digits.startsWith("8")) {
    normalized = `+7${digits.slice(1)}`;
  } else if (digits.length === 11 && digits.startsWith("7")) {
    normalized = `+7${digits.slice(1)}`;
  } else if (digits.length === 10) {
    normalized = `+7${digits}`;
  } else {
    return undefined;
  }

  if (!/^\+7\d{10}$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

export function hasUnknownProfilePatchKeys(body: Record<string, unknown>): boolean {
  const allowed = new Set(["fullName", "phone"]);
  return Object.keys(body).some((key) => !allowed.has(key));
}
