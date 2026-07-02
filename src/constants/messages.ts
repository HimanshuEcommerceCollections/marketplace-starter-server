/** Reusable, user-facing message strings. Keep wording centralized here. */
export const Messages = {
  AUTH: {
    INVALID_CREDENTIALS: "Invalid credentials",
    EMAIL_TAKEN: "An account with this email already exists",
    UNAUTHORIZED: "Authentication required",
    FORBIDDEN: "You do not have permission to perform this action",
    INVALID_TOKEN: "Invalid or expired token",
  },
  COMMON: {
    NOT_FOUND: "Resource not found",
    VALIDATION_FAILED: "Validation failed",
    INTERNAL_ERROR: "Internal server error",
  },
  PAYMENT: {
    NOT_CONFIGURED: "Payments are not configured",
    BOOKING_NOT_PAYABLE: "This booking is not awaiting payment",
    ALREADY_PAID: "This booking has already been paid",
    NOT_REFUNDABLE: "Only paid payments can be refunded",
    INVALID_SIGNATURE: "Invalid webhook signature",
  },
} as const;
