import type { PairedString } from "./paired";
import { vocabularyProblems, type VocabularyRule } from "./vocabulary";

/**
 * Board `12g-s` — what a written half may not be.
 *
 * Pure, so the console runs it as staff type and the save runs it again; the
 * two cannot disagree about whether a value is acceptable.
 */

export const STRING_MAX_LENGTH = 500;

export interface ValueProblem {
  error: "empty" | "too_long" | "unknown_placeholder" | "vocabulary";
  detail?: { placeholders?: string[]; rule?: VocabularyRule; match?: string };
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

/** The first problem with a value, in the order a person would fix it. */
export function valueProblem(entry: Pick<PairedString, "params">, raw: string): ValueProblem | null {
  const value = raw.trim();
  if (!value) return { error: "empty" };
  if (value.length > STRING_MAX_LENGTH) return { error: "too_long" };
  // A placeholder the consumer does not supply would render as `{name}` — or throw, outside production.
  const unknown = [...new Set([...value.matchAll(PLACEHOLDER)].map((match) => match[1]!))].filter(
    (name) => !entry.params.includes(name),
  );
  if (unknown.length > 0) return { error: "unknown_placeholder", detail: { placeholders: unknown } };
  const [problem] = vocabularyProblems(value);
  if (problem) return { error: "vocabulary", detail: { rule: problem.rule, match: problem.match } };
  return null;
}
