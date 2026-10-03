import type { Response } from "express";
import type { AccessRequest } from "../../access/middleware";
import { setNoStore } from "../../http/no-store";
import { apiError, ERROR_CODES } from "../../shared/errors";
import { isValidUuidParam } from "../uuid-param";
import {
  REVIEW_DECISION_LABELS,
  REVIEW_DECISIONS,
  REVIEW_STATE_LABELS,
  REVIEW_STATES,
  type ReviewDecision,
  type ReviewState,
} from "./constants";
import {
  getClientReview,
  listClientReviewHistory,
  listEligibleReviewManagers,
  listEligibleReviewers,
  REVIEW_COMMENT_MAX_LENGTH,
  ReviewServiceError,
  upsertClientReview,
} from "./repository";

function sendReviewError(res: Response, error: ReviewServiceError): void {
  setNoStore(res);
  if (error.code === "FORBIDDEN") {
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, error.message));
    return;
  }
  if (error.code === "CONFLICT") {
    res.status(409).json(apiError(ERROR_CODES.VALIDATION_ERROR, error.message));
    return;
  }
  if (error.code === "VALIDATION") {
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, error.message));
    return;
  }
  res.status(404).json(apiError(ERROR_CODES.NOT_FOUND, error.message));
}

export async function getClientReviewHandler(req: AccessRequest, res: Response): Promise<void> {
  const guid = typeof req.params.guid === "string" ? req.params.guid.trim() : "";
  if (!isValidUuidParam(guid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный идентификатор клиента."));
    return;
  }

  try {
    const review = await getClientReview(req.accessContext!, guid.toLowerCase());
    setNoStore(res);
    res.status(200).json({ review });
  } catch (error) {
    if (error instanceof ReviewServiceError) {
      sendReviewError(res, error);
      return;
    }
    throw error;
  }
}

export async function listClientReviewHistoryHandler(
  req: AccessRequest,
  res: Response,
): Promise<void> {
  const guid = typeof req.params.guid === "string" ? req.params.guid.trim() : "";
  if (!isValidUuidParam(guid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный идентификатор клиента."));
    return;
  }

  if (req.accessContext!.role !== "admin") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "История ревизии доступна только администратору."));
    return;
  }

  try {
    const items = await listClientReviewHistory(req.accessContext!, guid.toLowerCase());
    setNoStore(res);
    res.status(200).json({ items });
  } catch (error) {
    if (error instanceof ReviewServiceError) {
      sendReviewError(res, error);
      return;
    }
    throw error;
  }
}

export async function upsertClientReviewHandler(req: AccessRequest, res: Response): Promise<void> {
  const guid = typeof req.params.guid === "string" ? req.params.guid.trim() : "";
  if (!isValidUuidParam(guid)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный идентификатор клиента."));
    return;
  }

  const body = req.body as Record<string, unknown>;
  const reviewState = typeof body.reviewState === "string" ? body.reviewState.trim() : "";
  if (!(REVIEW_STATES as readonly string[]).includes(reviewState)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректное состояние проверки."));
    return;
  }

  let reviewDecision: ReviewDecision | null = null;
  if (body.reviewDecision !== undefined && body.reviewDecision !== null && body.reviewDecision !== "") {
    if (typeof body.reviewDecision !== "string") {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректное решение ревизии."));
      return;
    }
    const raw = body.reviewDecision.trim();
    if (!(REVIEW_DECISIONS as readonly string[]).includes(raw)) {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректное решение ревизии."));
      return;
    }
    reviewDecision = raw as ReviewDecision;
  }

  let proposedManagerGuid: string | null = null;
  if (body.proposedManagerGuid) {
    if (typeof body.proposedManagerGuid !== "string" || !isValidUuidParam(body.proposedManagerGuid)) {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный GUID менеджера."));
      return;
    }
    proposedManagerGuid = body.proposedManagerGuid.trim().toLowerCase();
  }

  let assignedReviewerUserId: string | null = null;
  if (body.assignedReviewerUserId) {
    if (typeof body.assignedReviewerUserId !== "string" || !isValidUuidParam(body.assignedReviewerUserId)) {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректный идентификатор проверяющего."));
      return;
    }
    assignedReviewerUserId = body.assignedReviewerUserId.trim().toLowerCase();
  }

  const commentRaw = typeof body.comment === "string" ? body.comment.trim() : null;
  if (commentRaw != null && commentRaw.length > REVIEW_COMMENT_MAX_LENGTH) {
    setNoStore(res);
    res.status(400).json(
      apiError(
        ERROR_CODES.VALIDATION_ERROR,
        `Комментарий не может быть длиннее ${REVIEW_COMMENT_MAX_LENGTH} символов.`,
      ),
    );
    return;
  }

  if (body.expectedVersion !== undefined && body.expectedVersion !== null) {
    if (typeof body.expectedVersion !== "number" && typeof body.expectedVersion !== "string") {
      setNoStore(res);
      res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректная версия записи."));
      return;
    }
  }

  const expectedVersion =
    body.expectedVersion === undefined || body.expectedVersion === null
      ? null
      : Number(body.expectedVersion);
  if (expectedVersion != null && !Number.isInteger(expectedVersion)) {
    setNoStore(res);
    res.status(400).json(apiError(ERROR_CODES.VALIDATION_ERROR, "Некорректная версия записи."));
    return;
  }

  const recheckConfirmed = body.recheckConfirmed === true;

  try {
    const review = await upsertClientReview(req.accessContext!, {
      actorUserId: req.authUser!.id,
      guidClient: guid.toLowerCase(),
      expectedVersion,
      reviewState: reviewState as ReviewState,
      reviewDecision,
      comment: commentRaw || null,
      proposedManagerGuid,
      assignedReviewerUserId,
      dueAt: typeof body.dueAt === "string" ? body.dueAt : null,
      recheckConfirmed,
    });
    setNoStore(res);
    res.status(200).json({ review });
  } catch (error) {
    if (error instanceof ReviewServiceError) {
      sendReviewError(res, error);
      return;
    }
    throw error;
  }
}

export async function reviewOptionsHandler(req: AccessRequest, res: Response): Promise<void> {
  if (req.accessContext!.role !== "admin") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Настройки ревизии доступны только администратору."));
    return;
  }
  setNoStore(res);
  res.status(200).json({
    states: REVIEW_STATES.map((state) => ({ id: state, label: REVIEW_STATE_LABELS[state] })),
    decisions: REVIEW_DECISIONS.map((decision) => ({
      id: decision,
      label: REVIEW_DECISION_LABELS[decision],
    })),
    commentMaxLength: REVIEW_COMMENT_MAX_LENGTH,
  });
}

export async function eligibleReviewManagersHandler(req: AccessRequest, res: Response): Promise<void> {
  if (req.accessContext!.role !== "admin") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Список менеджеров ревизии доступен только администратору."));
    return;
  }
  const items = await listEligibleReviewManagers();
  setNoStore(res);
  res.status(200).json({ items });
}

export async function eligibleReviewersHandler(req: AccessRequest, res: Response): Promise<void> {
  if (req.accessContext!.role !== "admin") {
    setNoStore(res);
    res.status(403).json(apiError(ERROR_CODES.FORBIDDEN, "Список проверяющих доступен только администратору."));
    return;
  }
  const items = await listEligibleReviewers();
  setNoStore(res);
  res.status(200).json({ items });
}
