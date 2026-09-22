import net from "net";

function normalizeIp(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  let ip = value.trim();
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  return net.isIP(ip) ? ip : null;
}

function parseCidr(cidr: string): { base: string; prefix: number; version: 4 | 6 } | null {
  const trimmed = cidr.trim();
  if (!trimmed.includes("/")) {
    const ip = normalizeIp(trimmed);
    return ip ? { base: ip, prefix: ip.includes(":") ? 128 : 32, version: ip.includes(":") ? 6 : 4 } : null;
  }

  const [baseRaw, prefixRaw] = trimmed.split("/");
  const base = normalizeIp(baseRaw);
  const prefix = Number(prefixRaw);
  if (!base || !Number.isInteger(prefix)) {
    return null;
  }
  const version: 4 | 6 = base.includes(":") ? 6 : 4;
  const maxPrefix = version === 4 ? 32 : 128;
  if (prefix < 0 || prefix > maxPrefix) {
    return null;
  }
  return { base, prefix, version };
}

function ipToBigInt(ip: string): bigint | null {
  if (net.isIP(ip) === 4) {
    return net
      .isIPv4(ip)
      ? BigInt(
          ip
            .split(".")
            .map((part) => Number(part))
            .reduce((acc, part) => (acc << 8n) + BigInt(part), 0n),
        )
      : null;
  }
  if (net.isIP(ip) === 6) {
    const expanded = expandIpv6(ip);
    if (!expanded) {
      return null;
    }
    return expanded.reduce((acc, part) => (acc << 16n) + BigInt(parseInt(part, 16)), 0n);
  }
  return null;
}

function expandIpv6(ip: string): string[] | null {
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) {
    return null;
  }
  const parts = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  if (parts.length !== 8) {
    return null;
  }
  return parts.map((part) => part.padStart(4, "0"));
}

export function isIpInTrustedList(ip: string, trustedEntries: string[]): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) {
    return false;
  }

  const target = ipToBigInt(normalized);
  if (target === null) {
    return false;
  }

  for (const entry of trustedEntries) {
    const cidr = parseCidr(entry);
    if (!cidr) {
      continue;
    }
    const base = ipToBigInt(cidr.base);
    if (base === null) {
      continue;
    }
    const width = cidr.version === 4 ? 32 : 128;
    const mask =
      cidr.prefix === 0
        ? 0n
        : ((1n << BigInt(cidr.prefix)) - 1n) << BigInt(width - cidr.prefix);
    if ((target & mask) === (base & mask)) {
      return true;
    }
  }

  return false;
}

export function getTrustedProxyEntries(): string[] {
  const raw = process.env.TRUSTED_PROXIES?.trim();
  if (!raw) {
    return [];
  }
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function resolveClientIp(input: {
  socketRemoteAddress?: string;
  xForwardedFor?: string | string[];
  trustedProxies?: string[];
}): string | null {
  const socketIp = normalizeIp(input.socketRemoteAddress);
  const trusted = input.trustedProxies ?? getTrustedProxyEntries();

  if (!socketIp || trusted.length === 0) {
    return socketIp;
  }

  if (!isIpInTrustedList(socketIp, trusted)) {
    return socketIp;
  }

  const forwardedRaw = input.xForwardedFor;
  const forwarded =
    typeof forwardedRaw === "string"
      ? forwardedRaw
      : Array.isArray(forwardedRaw)
        ? forwardedRaw.join(",")
        : "";
  if (!forwarded.trim()) {
    return socketIp;
  }

  const chain = forwarded
    .split(",")
    .map((part) => normalizeIp(part))
    .filter((part): part is string => Boolean(part));

  if (chain.length === 0) {
    return socketIp;
  }

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index]!;
    if (!isIpInTrustedList(candidate, trusted)) {
      return candidate;
    }
  }

  return chain[0] ?? socketIp;
}
