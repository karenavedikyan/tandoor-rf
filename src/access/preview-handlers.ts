import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth";
import { setNoStore } from "../http/no-store";
import { apiError, ERROR_CODES } from "../shared/errors";
import { resolvePreviewState } from "./preview";
import { searchPreviewCandidates, startEmployeePreview, stopEmployeePreview } from "./preview-service";

export async function previewStateHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const preview = await resolvePreviewState(req.sessionId);
  setNoStore(res);
  res.status(200).json({ preview });
}

export async function previewCandidatesHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    setNoStore(res);
    res.status(200).json({ items: [] });
    return;
  }
  const items = await searchPreviewCandidates(q, 20);
  setNoStore(res);
  res.status(200).json({ items });
}

export async function previewStartHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const targetUserId = String(req.body?.userId ?? req.body?.targetUserId ?? "").trim();
  if (!targetUserId) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Укажите пользователя для просмотра."));
    return;
  }
  if (!req.sessionId) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }

  try {
    const result = await startEmployeePreview({
      sessionId: req.sessionId,
      actorUserId: req.authUser!.id,
      targetUserId,
    });
    if (!result.ok) {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, result.message));
      return;
    }
  } catch {
    setNoStore(res);
    res.status(503).json(
      apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось включить режим просмотра."),
    );
    return;
  }

  const preview = await resolvePreviewState(req.sessionId);
  setNoStore(res);
  res.status(200).json({ ok: true, preview });
}

export async function previewStopHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.sessionId) {
    setNoStore(res);
    res.status(401).json(apiError(ERROR_CODES.UNAUTHORIZED, "Требуется авторизация."));
    return;
  }
  try {
    await stopEmployeePreview({
      sessionId: req.sessionId,
      actorUserId: req.authUser!.id,
    });
  } catch {
    setNoStore(res);
    res.status(503).json(
      apiError(ERROR_CODES.SERVICE_UNAVAILABLE, "Не удалось выйти из режима просмотра."),
    );
    return;
  }
  setNoStore(res);
  res.status(200).json({ ok: true, preview: { active: false } });
}
