export {
  emailService,
  EmailService,
  logEmailStartupState,
} from "./email.service";
export { resolveEmailProvider } from "./providers";
export type { EmailProvider, SendEmailParams, SentEmail } from "./providers";
export { buildVerificationEmail } from "./templates/verification";
export {
  buildBookingConfirmedEmail,
  buildBookingCancelledEmail,
} from "./templates/booking-status";
export type {
  VerificationEmailParams,
  VerificationEmailContent,
} from "./templates/verification";
export type { BookingStatusEmailParams } from "./templates/booking-status";
export type { EmailContent } from "./templates/layout";
