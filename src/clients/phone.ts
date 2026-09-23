const PHONE_SEARCH_STRIP_RE = /[\s()+\-]/g;

export function normalizePhoneForSearch(value: string): string {
  return value.replace(PHONE_SEARCH_STRIP_RE, "");
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function isRecognizedTelHref(phone: string): boolean {
  const trimmed = phone.trim();
  if (!trimmed || trimmed.includes(",")) {
    return false;
  }
  if (/[a-zA-Z\u0400-\u04FF]/.test(trimmed)) {
    return false;
  }
  if ((trimmed.match(/\+/g) ?? []).length > 1) {
    return false;
  }
  if (!/^[\d\s()+\-]+$/.test(trimmed)) {
    return false;
  }
  const digits = normalizePhoneForSearch(trimmed);
  return digits.length >= 10 && digits.length <= 15;
}

export function telHrefFromPhone(phone: string): string | null {
  if (!isRecognizedTelHref(phone)) {
    return null;
  }
  const digits = normalizePhoneForSearch(phone);
  return `+${digits.replace(/^\+/, "")}`;
}
