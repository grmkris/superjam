// oRPC typed error map (§12). Codes are surfaced to the web client as typed
// errors. Mirrors commonErrors (BadRequest/Unauthorized/Forbidden/NotFound/
// Conflict/Internal + QuotaExceeded/PaymentRequired).
export const commonErrors = {
  BAD_REQUEST: { status: 400 },
  UNAUTHORIZED: { status: 401 },
  PAYMENT_REQUIRED: { status: 402 },
  FORBIDDEN: { status: 403 },
  NOT_FOUND: { status: 404 },
  CONFLICT: { status: 409 },
  QUOTA_EXCEEDED: { status: 429 },
  RATE_LIMITED: { status: 429 },
  INTERNAL: { status: 500 },
} as const;

export type CommonErrorCode = keyof typeof commonErrors;
