import dns from "node:dns/promises";
import { OperationDeadline } from "./deadline";
import { isBlockedIpAddress } from "./ip-security";

export type ResolvedPortalAddress = {
  address: string;
  family: 4 | 6;
};

export type ResolvePortalAddressesFn = (
  hostname: string,
  deadline: OperationDeadline,
) => Promise<ResolvedPortalAddress[]>;

async function resolveAllPortalAddresses(hostname: string): Promise<ResolvedPortalAddress[]> {
  const addresses: ResolvedPortalAddress[] = [];
  const errors: unknown[] = [];

  try {
    for (const address of await dns.resolve4(hostname)) {
      addresses.push({ address, family: 4 });
    }
  } catch (error) {
    errors.push(error);
  }

  try {
    for (const address of await dns.resolve6(hostname)) {
      addresses.push({ address, family: 6 });
    }
  } catch (error) {
    errors.push(error);
  }

  if (addresses.length === 0) {
    throw new Error("Bitrix24 portal host could not be resolved.");
  }

  return addresses;
}

export async function resolvePortalAddressesSafely(
  hostname: string,
  deadline: OperationDeadline,
  resolveFn: (
    hostname: string,
  ) => Promise<ResolvedPortalAddress[]> = resolveAllPortalAddresses,
): Promise<ResolvedPortalAddress> {
  if (deadline.expired()) {
    throw new Error("TOTAL_DURATION_EXCEEDED");
  }

  const remainingMs = deadline.remainingMs();
  const addresses = await Promise.race([
    resolveFn(hostname),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("TIMEOUT")), remainingMs);
      timer.unref?.();
    }),
  ]);

  for (const entry of addresses) {
    if (isBlockedIpAddress(entry.address)) {
      throw new Error("HOST_BLOCKED");
    }
  }

  return addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
}
