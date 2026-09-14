/**
 * The sign-up form's state between a refusal and the next attempt.
 *
 * Its own plain module, not the client form's: a value exported from a
 * `"use client"` file is a client reference when a server module reads it, and
 * both the server action and the server page need this shape.
 */
export interface SignUpFormState {
  values: {
    fullName: string;
    phone: string;
    email: string;
    intent: "buying" | "listing";
  };
  termsAccepted: boolean;
  /** An `AuthOutcome` kind, or null before the first attempt. */
  error: string | null;
  retry: number | null;
  limit: number | null;
}

/** Board 7a: `+971` pre-filled, because every mobile this directory serves starts with it. */
export const PHONE_PREFILL = "+971 ";

export function initialSignUpState(input: {
  intent: "buying" | "listing";
  error?: string | null;
}): SignUpFormState {
  return {
    values: { fullName: "", phone: PHONE_PREFILL, email: "", intent: input.intent },
    termsAccepted: false,
    error: input.error ?? null,
    retry: null,
    limit: null,
  };
}
