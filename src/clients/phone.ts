const PHONE_SEARCH_STRIP_RE = /[\s()+\-]/g;

export function normalizePhoneForSearch(value: string): string {
  return value.replace(PHONE_SEARCH_STRIP_RE, "");
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function telHrefFromPhone(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed || trimmed.includes(",")) {
    return null;
  }
  if (/[a-zA-Z\u0400-\u04FF]/.test(trimmed)) {
    return null;
  }
  if (!/^[\d\s()+\-]+$/.test(trimmed)) {
    return null;
  }
  if ((trimmed.match(/\+/g) ?? []).length > 1) {
    return null;
  }

  let digits: string;
  if (trimmed.startsWith("+")) {
    digits = digitsOnly(trimmed.slice(1));
  } else if (trimmed.startsWith("00")) {
    digits = digitsOnly(trimmed.slice(2));
  } else {
    return null;
  }

  if (digits.length < 10 || digits.length > 15) {
    return null;
  }

  return `+${digits}`;
}

export function isRecognizedTelHref(phone: string): boolean {
  return telHrefFromPhone(phone) !== null;
}
