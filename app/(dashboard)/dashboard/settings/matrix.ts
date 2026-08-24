/**
 * What the alert matrix may contain.
 *
 * Not in actions.ts: a `"use server"` module may only export async functions,
 * and everything it exports becomes a callable endpoint. A const array is
 * neither. Next reports this at module evaluation rather than at build, so it
 * ships and then fails on the first request — which is how it got here twice.
 */
export const EVENTS = [
  "enquiry_received",
  "enquiry_unanswered",
  "enquiry_escalated",
  "quote_accepted",
  "quote_expiring",
  "review_posted",
  "document_expiring",
  "weekly_digest",
] as const;

export const CHANNELS = ["whatsapp", "sms", "email", "in_app"] as const;

export const ESCALATION_CHOICES = [30, 60, 120, 240, 480] as const;
export const NUDGE_CHOICES = [12, 24, 48, 72] as const;

export type AlertEvent = (typeof EVENTS)[number];
export type AlertChannel = (typeof CHANNELS)[number];
