export type EffectiveDelegationStatus =
  | "draft"
  | "pending_approval"
  | "revoked"
  | "future"
  | "expired"
  | "active"
  | "access_suspended";

const LABELS: Record<EffectiveDelegationStatus, string> = {
  draft: "Черновик",
  pending_approval: "На согласовании",
  revoked: "Отозвано",
  future: "Срок ещё не начался",
  expired: "Срок истёк",
  active: "Действует",
  access_suspended: "Доступ приостановлен до согласования изменений",
};

export function computeEffectiveDelegationStatus(input: {
  status: string;
  starts_at: Date | string;
  ends_at: Date | string;
  revoked_at: Date | string | null;
  pending_change: boolean;
  now?: Date;
}): {
  effectiveStatus: EffectiveDelegationStatus;
  effectiveLabel: string;
  accessSuspended: boolean;
} {
  const now = input.now ?? new Date();
  if (input.revoked_at || input.status === "revoked") {
    return { effectiveStatus: "revoked", effectiveLabel: LABELS.revoked, accessSuspended: true };
  }
  if (input.status === "draft") {
    return { effectiveStatus: "draft", effectiveLabel: LABELS.draft, accessSuspended: true };
  }
  if (input.status === "pending_approval") {
    return {
      effectiveStatus: "pending_approval",
      effectiveLabel: LABELS.pending_approval,
      accessSuspended: true,
    };
  }
  if (input.status === "active") {
    if (input.pending_change) {
      return {
        effectiveStatus: "access_suspended",
        effectiveLabel: LABELS.access_suspended,
        accessSuspended: true,
      };
    }
    const starts = new Date(input.starts_at);
    const ends = new Date(input.ends_at);
    if (now.getTime() < starts.getTime()) {
      return { effectiveStatus: "future", effectiveLabel: LABELS.future, accessSuspended: true };
    }
    if (now.getTime() >= ends.getTime()) {
      return { effectiveStatus: "expired", effectiveLabel: LABELS.expired, accessSuspended: true };
    }
    return { effectiveStatus: "active", effectiveLabel: LABELS.active, accessSuspended: false };
  }
  return {
    effectiveStatus: "revoked",
    effectiveLabel: LABELS.revoked,
    accessSuspended: true,
  };
}

export function enrichDelegationRow<T extends Record<string, unknown>>(
  row: T,
  now?: Date,
): T & {
  effective_status: EffectiveDelegationStatus;
  effective_label: string;
  access_suspended: boolean;
} {
  const computed = computeEffectiveDelegationStatus({
    status: String(row.status),
    starts_at: row.starts_at as Date | string,
    ends_at: row.ends_at as Date | string,
    revoked_at: (row.revoked_at as Date | string | null) ?? null,
    pending_change: Boolean(row.pending_change),
    now,
  });
  return {
    ...row,
    effective_status: computed.effectiveStatus,
    effective_label: computed.effectiveLabel,
    access_suspended: computed.accessSuspended,
  };
}
