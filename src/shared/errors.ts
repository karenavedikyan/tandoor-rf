export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export function apiError(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export const ERROR_CODES = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  CSRF_REJECTED: "CSRF_REJECTED",
  INVALID_CONTENT_TYPE: "INVALID_CONTENT_TYPE",
} as const;
