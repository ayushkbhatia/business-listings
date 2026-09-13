/**
 * What the two record forms get back from their actions.
 *
 * Its own module because `actions.ts` is `"use server"`, where every export
 * becomes a callable endpoint and only async functions may be exported. A type
 * and a constant have no business being either.
 */
export type RecordFormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string };

export const IDLE: RecordFormState = { status: "idle" };
