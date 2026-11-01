export type TanTrackerTransferStatus = "active" | "waiting" | "delivered" | "completed";

export type TanTrackerPartyKind = "user" | "external";

export type TanTrackerPartyRow = {
  id: string;
  kind: TanTrackerPartyKind;
  user_id: string | null;
  display_name: string;
  phone_e164: string | null;
};

export type TanTrackerTransferRow = {
  id: string;
  public_code: string;
  item_title: string;
  qty_label: string | null;
  comment_text: string | null;
  status: TanTrackerTransferStatus;
  creator_party_id: string;
  holder_party_id: string;
  pending_party_id: string | null;
  final_recipient_party_id: string | null;
  due_at: Date | null;
  holder_since: Date;
  handoff_version: number;
  allow_legacy_complete: boolean;
  completed_at: Date | null;
  row_version: number;
  first_custody_at?: Date | null;
  from_external?: boolean;
  general_archived_at?: Date | null;
  deleted_at?: Date | null;
};

export type TanTrackerTimelineRow = {
  id: string;
  transfer_id: string;
  occurred_at: Date;
  from_party_id: string | null;
  to_party_id: string | null;
  note: string;
};

export type TanTrackerScopeContext = {
  userId: string;
  role: string;
  employeeId: string | null;
  actorPartyId: string | null;
  previewReadOnly: boolean;
};

export type TanTrackerActiveInvitationDto = {
  hv: number;
  pendingId: string;
  holderId: string;
  item: string;
  id: string;
  invitationToken?: string;
};

export type TanTrackerAttachmentDto = {
  id: string;
  name: string;
  mimeType: string;
  byteSize: number;
  addedAt: number;
  addedBy?: string | null;
};

export type TanTrackerPersonalRecipientViewDto = {
  recipientPartyId: string;
  canonicalName: string;
  personalName: string | null;
  editedAt: number | null;
  editedByUserId: string | null;
  editedByDisplayName: string | null;
};

export type TanTrackerOrderDto = {
  id: string;
  item: string;
  qty?: string;
  holderId: string;
  pendingId: string | null;
  status: TanTrackerTransferStatus;
  dueAt: number | null;
  comment: string;
  holderSince: number;
  /** Canonical custody proof, not inferred from user-editable timeline text. */
  hasConfirmedReceipt?: boolean;
  timeline: Array<{ at: number; from: string | null; to: string | null; note: string }>;
  finalRecipientId?: string | null;
  createdById?: string | null;
  allowLegacyComplete?: boolean;
  handoffVer?: number;
  revokedParticipants?: string[];
  activeInvitation?: TanTrackerActiveInvitationDto | null;
  attachments?: TanTrackerAttachmentDto[];
  /** Holder may edit all creation fields before the first confirmed custody handoff. */
  canEditDraft?: boolean;
  rowVersion?: number;
  fromExternal?: boolean;
  generalArchived?: boolean;
  /** Server hint for registry delete before first confirmed receipt (authoritative for UI). */
  canDeleteBeforeReceipt?: boolean;
  /** Technical admin may delete any visible track regardless of custody (authoritative for UI). */
  canAdminDeleteTransfer?: boolean;
  /** Signed public-holder capability scoped to this order (external person bootstrap only). */
  holderAccessToken?: string | null;
  /** Per-viewer private display names for route recipients (not shared invitations). */
  personalRecipientViews?: Record<string, TanTrackerPersonalRecipientViewDto>;
};

export type TanTrackerRegistryPersonalBootstrap = {
  hiddenTransferIds: string[];
  archivedTransferIds: string[];
  canManageGeneralArchive: boolean;
};

export type TanTrackerContactDto = {
  id: string;
  name: string;
  phone: string;
  kind: TanTrackerPartyKind;
  employeeId?: string | null;
  team?: string | null;
};

export type TanTrackerActorContactDto = {
  id: string;
  kind: TanTrackerPartyKind;
  employeeId?: string | null;
};
