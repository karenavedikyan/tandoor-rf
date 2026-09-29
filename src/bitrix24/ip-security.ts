import { isIPv4, isIPv6 } from "node:net";

function isPrivateOrReservedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c, d] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  return false;
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fe80:")) {
    return true;
  }
  if (/^f[cd][0-9a-f]{0,2}:/i.test(normalized)) {
    return true;
  }
  return false;
}

export function expandIpv4MappedAddress(address: string): string {
  const normalized = address.trim().toLowerCase();
  if (isIPv4(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("::ffff:")) {
    const suffix = normalized.slice("::ffff:".length);
    if (isIPv4(suffix)) {
      return suffix;
    }
    const hexMatch = suffix.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMatch) {
      const hi = Number.parseInt(hexMatch[1]!, 16);
      const lo = Number.parseInt(hexMatch[2]!, 16);
      return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    }
  }

  const fullMapped = normalized.match(/^0:0:0:0:0:ffff:(.+)$/);
  if (fullMapped && isIPv4(fullMapped[1]!)) {
    return fullMapped[1]!;
  }

  return normalized;
}

export function isBlockedIpAddress(address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed) {
    return true;
  }

  const mappedIpv4 = expandIpv4MappedAddress(trimmed);
  if (isIPv4(mappedIpv4)) {
    return isPrivateOrReservedIpv4(mappedIpv4);
  }

  if (isIPv6(trimmed)) {
    if (isPrivateOrReservedIpv6(trimmed)) {
      return true;
    }
    const expanded = expandIpv4MappedAddress(trimmed);
    if (expanded !== trimmed && isIPv4(expanded)) {
      return isPrivateOrReservedIpv4(expanded);
    }
    return false;
  }

  return true;
}
