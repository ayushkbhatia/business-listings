import { isCredentialKind } from "@/lib/credentials/kinds";

/**
 * Board `6a-s` — the field rules for a services trade's landing-page wording.
 *
 * Pure, so the panel on `/admin/categories` says what is wrong under a field
 * before the round trip and `saveServicesLandingCopy` refuses the same shapes
 * after it — one set of rules, two readers. The migration's CHECKs are the
 * floor under both.
 */

/** Three, by CHECK. The board draws three and a fourth is a questionnaire. */
export const MAX_ASKS = 3;
export const PLURAL_MIN = 2;
export const PLURAL_MAX = 60;
export const ASK_QUESTION_MAX = 160;
export const ASK_WHY_MAX = 400;

export interface CategoryAskInput {
  question: string;
  why: string;
}

export type ServicesLandingProblem =
  | "plural_too_short"
  | "plural_too_long"
  | "credential_unknown"
  | "too_many_asks"
  | "ask_empty"
  | "ask_question_too_long"
  | "ask_why_too_long";

/** Collapse runs of whitespace and trim — what a person meant to type. */
export function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The questions as they will be saved: tidied, and without the rows that have
 * neither half written.
 *
 * A blank row is one somebody added and has not used yet. The panel drops it
 * on save rather than refusing it, so pressing *Add a question* never raises an
 * error by itself. Half a row is different — a question with no reason is a
 * mistake worth stopping for, and `servicesLandingProblems` still says so. The
 * service stays strict: a blank row that reaches it was sent on purpose.
 */
export function writtenAsks(asks: readonly CategoryAskInput[]): CategoryAskInput[] {
  return asks
    .map((ask) => ({ question: tidy(ask.question), why: tidy(ask.why) }))
    .filter((ask) => ask.question !== "" || ask.why !== "");
}

/**
 * The field rules, pure, so the panel can say what is wrong under a field
 * before the round trip and the service refuses the same shapes after it.
 */
export function servicesLandingProblems(input: {
  pluralHuman: string;
  credentialKind: string | null;
  asks: readonly CategoryAskInput[];
}): ServicesLandingProblem[] {
  const problems: ServicesLandingProblem[] = [];
  const plural = tidy(input.pluralHuman);
  if (plural !== "" && plural.length < PLURAL_MIN) problems.push("plural_too_short");
  if (plural.length > PLURAL_MAX) problems.push("plural_too_long");
  if (input.credentialKind !== null && !isCredentialKind(input.credentialKind)) {
    problems.push("credential_unknown");
  }
  if (input.asks.length > MAX_ASKS) problems.push("too_many_asks");
  for (const ask of input.asks) {
    const question = tidy(ask.question);
    const why = tidy(ask.why);
    if (question === "" || why === "") problems.push("ask_empty");
    if (question.length > ASK_QUESTION_MAX) problems.push("ask_question_too_long");
    if (why.length > ASK_WHY_MAX) problems.push("ask_why_too_long");
  }
  return [...new Set(problems)];
}

