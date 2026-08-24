/**
 * The two numbers the OTP screens and the delivery hook both need.
 *
 * Neither side owns them. They lived in the client component that draws the
 * field and in the route that sends the message, which meant the server page
 * importing one of them got a client reference rather than a number — it
 * rendered as the source of a function. Plain module, no directive, imported by
 * both.
 */

/**
 * Board 7a says six digits. It sizes the field and writes the hint; the field
 * itself accepts four to ten, because Supabase's code length is a project
 * setting and hard-coding a maximum means the day somebody changes it, every
 * code is silently truncated and nobody can sign in.
 *
 * The Supabase project currently issues eight. See docs/auth-whatsapp-otp.md.
 */
export const OTP_LENGTH = 6;

/**
 * Board 7a says ten minutes. Supabase enforces the real expiry from the
 * project's `MAILER_OTP_EXP` / `SMS_OTP_EXP`; this is the number the message
 * and the screen quote, and the project has to be set to match.
 */
export const OTP_EXPIRY_MINUTES = 10;
