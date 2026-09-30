import ipaddr from "ipaddr.js";

function isBlockedIpv4(address: ipaddr.IPv4): boolean {
  const range = address.range();
  if (
    range === "unspecified" ||
    range === "broadcast" ||
    range === "multicast" ||
    range === "linkLocal" ||
    range === "loopback" ||
    range === "private" ||
    range === "reserved"
  ) {
    return true;
  }
  const [a, b] = address.octets;
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
}

function isBlockedIpv6(address: ipaddr.IPv6): boolean {
  if (address.isIPv4MappedAddress()) {
    return isBlockedIpv4(address.toIPv4Address());
  }
  const range = address.range();
  return (
    range === "unspecified" ||
    range === "loopback" ||
    range === "linkLocal" ||
    range === "uniqueLocal" ||
    range === "multicast" ||
    range === "reserved"
  );
}

export function parseIpAddress(address: string): ipaddr.IPv4 | ipaddr.IPv6 {
  const trimmed = address.trim();
  if (ipaddr.IPv4.isValid(trimmed)) {
    return ipaddr.IPv4.parse(trimmed);
  }
  if (ipaddr.IPv6.isValid(trimmed)) {
    return ipaddr.IPv6.parse(trimmed);
  }
  throw new Error("INVALID_IP");
}

export function isBlockedIpAddress(address: string): boolean {
  try {
    const parsed = parseIpAddress(address);
    return parsed.kind() === "ipv4"
      ? isBlockedIpv4(parsed as ipaddr.IPv4)
      : isBlockedIpv6(parsed as ipaddr.IPv6);
  } catch {
    return true;
  }
}

export function expandIpv4MappedAddress(address: string): string {
  try {
    const parsed = parseIpAddress(address);
    if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (parsed as ipaddr.IPv6).toIPv4Address().toString();
    }
    return parsed.toString();
  } catch {
    return address.trim().toLowerCase();
  }
}
