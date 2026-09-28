import { loadAccessContext } from "./context";
import { isClientInScope } from "./policy";

export const DELEGATION_CLIENTS_RESTRICTED_MESSAGE =
  "Состав клиентов недоступен в пределах ваших полномочий.";

export type DelegationClientEntry = {
  guid: string;
  name: string;
};

export type DelegationClientsAccess =
  | { access: "visible"; clients: DelegationClientEntry[] }
  | { access: "restricted"; clients: null; message: string };

export async function resolveDelegationClientsAccess(input: {
  actorUserId: string;
  actorRole: string;
  delegatorUserId: string;
  entries: DelegationClientEntry[];
}): Promise<DelegationClientsAccess> {
  if (input.entries.length === 0) {
    return { access: "visible", clients: [] };
  }

  if (input.actorRole === "admin") {
    return { access: "visible", clients: input.entries };
  }

  if (input.actorRole === "coordinator") {
    const delegatorContext = await loadAccessContext(input.delegatorUserId);
    for (const entry of input.entries) {
      const allowed = await isClientInScope(delegatorContext, entry.guid);
      if (!allowed) {
        return {
          access: "restricted",
          clients: null,
          message: DELEGATION_CLIENTS_RESTRICTED_MESSAGE,
        };
      }
    }
    return {
      access: "visible",
      clients: input.entries.map((entry) => ({ guid: entry.guid, name: entry.name })),
    };
  }

  const actorContext = await loadAccessContext(input.actorUserId, input.actorRole as never);
  if (actorContext.explicitlyDeniedAll) {
    return {
      access: "restricted",
      clients: null,
      message: DELEGATION_CLIENTS_RESTRICTED_MESSAGE,
    };
  }

  for (const entry of input.entries) {
    const allowed = await isClientInScope(actorContext, entry.guid);
    if (!allowed) {
      return {
        access: "restricted",
        clients: null,
        message: DELEGATION_CLIENTS_RESTRICTED_MESSAGE,
      };
    }
  }

  return {
    access: "visible",
    clients: input.entries.map((entry) => ({ guid: entry.guid, name: entry.name })),
  };
}

export async function assertActorCanViewDelegationClientsForApproval(input: {
  actorUserId: string;
  actorRole: string;
  delegatorUserId: string;
  entries: DelegationClientEntry[];
}): Promise<void> {
  const view = await resolveDelegationClientsAccess(input);
  if (view.access === "restricted") {
    const { AccessServiceError } = await import("./db");
    throw new AccessServiceError(
      "Недостаточно прав для просмотра состава клиентов замещения.",
      "FORBIDDEN",
    );
  }
}
