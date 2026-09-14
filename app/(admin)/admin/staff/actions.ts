"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { formatDateTime, formatRelative } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import {
  changeStaffRole,
  deactivateStaff,
  inviteStaff,
  resendStaffInvite,
  revokeStaffInvite,
  type StaffError,
} from "@/lib/staff/service";
import { STAFF_EMAIL_DOMAINS } from "@/lib/staff/policy";

/**
 * Board 4i's five writes.
 *
 * Thin on purpose. `lib/staff/service.ts` asserts `staff.manage`, validates the
 * reason, takes the roster lock and decides every refusal; this file turns a
 * form into arguments and a refusal token into a sentence. Nothing here
 * re-checks a rule, because a second copy of a rule is a copy that drifts.
 */

export type StaffActionResult =
  | {
      ok: true;
      message: string;
      /** A link to hand over by other means, where the email did not go. */
      link?: string;
    }
  | { ok: false; error: string; field?: "email" | "role" | "reason" };

const WRITTEN: Record<StaffError, MessageKey> = {
  self: "admin.staff.error.self",
  last_ops_lead: "admin.staff.error.last_ops_lead",
  not_staff: "admin.staff.error.not_staff",
  same_role: "admin.staff.error.same_role",
  suspended: "admin.staff.error.suspended",
  not_found: "admin.staff.error.not_found",
  invalid_role: "admin.staff.error.invalid_role",
  invalid_email: "admin.staff.error.invalid_email",
  outside_domain: "admin.staff.error.outside_domain",
  already_staff: "admin.staff.error.already_staff",
  already_invited: "admin.staff.error.already_invited",
  seller_seat: "admin.staff.error.seller_seat",
  not_outstanding: "admin.staff.error.not_outstanding",
  too_soon: "admin.staff.error.too_soon",
};

const FIELD: Partial<Record<StaffError, "email" | "role">> = {
  invalid_email: "email",
  outside_domain: "email",
  already_staff: "email",
  already_invited: "email",
  seller_seat: "email",
  invalid_role: "role",
  same_role: "role",
};

function written(error: StaffError, extra?: { retryAt?: Date }): StaffActionResult {
  const field = FIELD[error];
  return {
    ok: false,
    error: t(WRITTEN[error], {
      domains: STAFF_EMAIL_DOMAINS.join(", "),
      when: extra?.retryAt ? formatRelative(extra.retryAt) : "",
    }),
    ...(field ? { field } : {}),
  };
}

function refused(error: unknown): StaffActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.staff.error.not_yours") };
  if (error instanceof AuditReasonError) {
    return { ok: false, error: t("admin.staff.error.reason"), field: "reason" };
  }
  throw error;
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function settle(): void {
  revalidatePath("/admin/staff");
  // Every one of these writes a row the log shows.
  revalidatePath("/admin/audit");
}

export async function invite(form: FormData): Promise<StaffActionResult> {
  const seat = await requireStaff();
  try {
    const result = await inviteStaff({
      actor: seat.actor,
      email: field(form, "email"),
      role: field(form, "role"),
      reason: field(form, "reason"),
      inviterName: seat.name,
    });
    if (!result.ok) return written(result.error);
    settle();
    return {
      ok: true,
      message: t(result.delivered ? "admin.staff.invited" : "admin.staff.invited_not_sent", {
        when: formatDateTime(result.expiresAt),
      }),
      ...(result.link ? { link: result.link } : {}),
    };
  } catch (error) {
    return refused(error);
  }
}

export async function resend(form: FormData): Promise<StaffActionResult> {
  const seat = await requireStaff();
  try {
    const result = await resendStaffInvite({
      actor: seat.actor,
      inviteId: field(form, "inviteId"),
      reason: field(form, "reason"),
      inviterName: seat.name,
    });
    if (!result.ok) return written(result.error, result.retryAt ? { retryAt: result.retryAt } : undefined);
    settle();
    return {
      ok: true,
      message: t(result.delivered ? "admin.staff.resent" : "admin.staff.resent_not_sent", {
        when: formatDateTime(result.expiresAt),
      }),
      ...(result.link ? { link: result.link } : {}),
    };
  } catch (error) {
    return refused(error);
  }
}

export async function revoke(form: FormData): Promise<StaffActionResult> {
  const seat = await requireStaff();
  try {
    const result = await revokeStaffInvite({
      actor: seat.actor,
      inviteId: field(form, "inviteId"),
      reason: field(form, "reason"),
    });
    if (!result.ok) return written(result.error);
    settle();
    return { ok: true, message: t("admin.staff.revoked") };
  } catch (error) {
    return refused(error);
  }
}

export async function changeRole(form: FormData): Promise<StaffActionResult> {
  const seat = await requireStaff();
  try {
    const result = await changeStaffRole({
      actor: seat.actor,
      userId: field(form, "userId"),
      role: field(form, "role"),
      reason: field(form, "reason"),
    });
    if (!result.ok) return written(result.error);
    settle();
    return { ok: true, message: t("admin.staff.role_changed") };
  } catch (error) {
    return refused(error);
  }
}

export async function deactivate(form: FormData): Promise<StaffActionResult> {
  const seat = await requireStaff();
  try {
    const result = await deactivateStaff({
      actor: seat.actor,
      userId: field(form, "userId"),
      reason: field(form, "reason"),
    });
    if (!result.ok) return written(result.error);
    settle();
    return { ok: true, message: t("admin.staff.deactivated") };
  } catch (error) {
    return refused(error);
  }
}
