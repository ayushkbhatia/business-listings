"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { EXPIRY_WARN_MAX, EXPIRY_WARN_MIN, parseTerms, RULE_IDS, TERM_MAX_LENGTH, TERMS_MAX, type CheckRules, type RuleId, type RulesProblem } from "@/lib/moderation/rules";
import { applyRules, previewRules, type RulesPreview } from "@/lib/moderation/tuning";
import { t } from "@/lib/i18n";

/**
 * Board 4b's rule tuning, at the request boundary. `queue.rules` is ops lead
 * alone, checked in the service; the wording of every refusal is here.
 */

export interface RulesInput {
  disabled: string[];
  expiryWarnDays: number;
  scanConfidencePercent: number;
  nameSimilarityPercent: number;
  bannedTerms: string;
}

export type PreviewResult = RulesPreview | { ok: false; error: string };
export type ApplyResult = { ok: true; message: string } | { ok: false; error: string };

function toRules(input: RulesInput): CheckRules {
  return {
    disabled: input.disabled.filter((id): id is RuleId => RULE_IDS.has(id)),
    expiryWarnDays: Math.round(Number(input.expiryWarnDays)),
    scanConfidenceFloor: Math.round(Number(input.scanConfidencePercent)) / 100,
    nameSimilarityFloor: Math.round(Number(input.nameSimilarityPercent)) / 100,
    bannedTerms: parseTerms(input.bannedTerms),
  };
}

function problemText(problem: RulesProblem): string {
  return t(`admin.queue_rules.problem.${problem}`, {
    min: EXPIRY_WARN_MIN,
    max: EXPIRY_WARN_MAX,
    terms: TERMS_MAX,
    length: TERM_MAX_LENGTH,
  });
}

export async function preview(input: RulesInput): Promise<PreviewResult> {
  const seat = await requireStaff();
  try {
    const result = await previewRules({ actor: seat.actor, rules: toRules(input) });
    return result.ok ? result : { ok: false, error: problemText(result.problem) };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
    throw error;
  }
}

export async function apply(input: RulesInput & { reason: string }): Promise<ApplyResult> {
  const seat = await requireStaff();
  try {
    const result = await applyRules({ actor: seat.actor, rules: toRules(input), reason: input.reason });
    if (!result.ok) return { ok: false, error: problemText(result.problem) };
    revalidatePath("/admin/queue", "layout");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue_rules.applied") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
    throw error;
  }
}
