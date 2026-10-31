import type { Response } from "express";
import { setNoStore } from "../http/no-store";
import type { AccessRequest } from "../access/middleware";
import { apiError, ERROR_CODES } from "../shared/errors";
import { withTransaction } from "../access/db";
import { buildTanTrackerBootstrap } from "./service";
import { requireTanTrackerMutationAccess } from "./guards";
import type { ExternalRecipientInput } from "./party-eligibility";
import { createTransferInTransaction } from "./create-transfer-service";

type CreateBody = {
  item?: string;
  qty?: string;
  comment?: string;
  dueAt?: string | null;
  finalRecipientPartyId?: string;
  finalRecipientExternal?: ExternalRecipientInput;
  relayPartyId?: string | null;
  relayExternal?: ExternalRecipientInput;
  stagingAttachmentIds?: string[];
};

function parseDueAt(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error("Некорректная дата срока."), { http: 400 });
  }
  return d;
}

export async function createTransferHandler(req: AccessRequest, res: Response): Promise<void> {
  const gate = requireTanTrackerMutationAccess(req, res);
  if (!gate) return;
  const { user, access } = gate;

  const body = req.body as CreateBody;
  const item = String(body.item ?? "").trim().slice(0, 500);
  if (!item) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите, что передаёте."));
    return;
  }

  let created: string;
  try {
    created = await withTransaction(async (client) =>
      createTransferInTransaction(
        client,
        { user, access },
        {
          item,
          qty: body.qty,
          comment: body.comment,
          dueAt: parseDueAt(body.dueAt),
          finalRecipientPartyId: body.finalRecipientPartyId,
          finalRecipientExternal: body.finalRecipientExternal,
          relayPartyId: body.relayPartyId,
          relayExternal: body.relayExternal,
          stagingAttachmentIds: body.stagingAttachmentIds,
        },
      ),
    );
  } catch (err: unknown) {
    const http = (err as { http?: number }).http;
    const message = err instanceof Error ? err.message : "Не удалось создать передачу.";
    if (http === 400 || http === 403 || http === 404) {
      setNoStore(res);
      res
        .status(http)
        .json(apiError(http === 403 ? ERROR_CODES.FORBIDDEN : ERROR_CODES.VALIDATION_ERROR, message));
      return;
    }
    throw err;
  }

  setNoStore(res);
  const forceRefreshFault =
    process.env.NODE_ENV === "test" && process.env.TT_TEST_BOOTSTRAP_FAIL_AFTER_CREATE === "1";
  try {
    if (forceRefreshFault) {
      throw new Error("injected bootstrap failure");
    }
    const bootstrap = await buildTanTrackerBootstrap(req.authUser!, access);
    res.status(201).json({
      publicCode: created,
      bootstrap,
    });
  } catch {
    res.status(201).json({
      publicCode: created,
      bootstrap: null,
      refreshRequired: true,
    });
  }
}
