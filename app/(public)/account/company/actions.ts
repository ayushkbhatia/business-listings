"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import {
  addAddress,
  archiveAddress,
  createCompany,
  isRuleFlag,
  setDefaultAddress,
  setRuleFlag,
  updateAddress,
  updateDetails,
  updateRule,
} from "@/lib/buyer-company/service";
import {
  changeSeat,
  deactivateMember,
  inviteMember,
  leaveCompany,
  resendInvite,
  revokeInvite,
} from "@/lib/buyer-company/team-service";
import { answerQuery, approveRequest, queryRequest, withdrawRequest } from "@/lib/buyer-company/approvals";
import type { AddressField } from "@/lib/buyer-company/address";
import type { DetailsField } from "@/lib/buyer-company/details";
import { t } from "@/lib/i18n";
import { addressFieldMessage, companyError, detailsFieldMessage, inviteFieldMessage, seatFieldMessage } from "./_errors";

/**
 * Board `7b` — every write on `/account/company`.
 *
 * Each resolves the person from the session and hands the service their id.
 * Whether they may do it is the service's question, answered from the
 * membership record under the company lock — a server action is a URL, and the
 * check has to hold for a request that never met this screen.
 *
 * Results carry sentences, worded here with `t()`, so a client component
 * renders strings and never a function (the server/client boundary this
 * project breaks most often).
 */

export type FieldErrors = Record<string, string>;
export type CompanyActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fields?: FieldErrors };

export type InviteActionResult =
  | { ok: true; acceptUrl: string; emailed: boolean; email: string }
  | { ok: false; error: string; fields?: FieldErrors };

const PATH = "/account/company";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function who(): Promise<string | null> {
  const actor = await getActor();
  return actor?.id ?? null;
}

function signedOut(): CompanyActionResult {
  return { ok: false, error: t("company.error.signed_out") };
}

function done(message?: string): CompanyActionResult {
  revalidatePath(PATH);
  revalidatePath(`${PATH}/approvals`);
  revalidatePath(`${PATH}/history`);
  return message ? { ok: true, message } : { ok: true };
}

const DETAIL_KEYS: DetailsField[] = ["name", "trn", "licenceNumber", "accountsEmail"];

function detailsFrom(form: FormData): Partial<Record<DetailsField, string>> {
  return Object.fromEntries(DETAIL_KEYS.map((key) => [key, text(form, key)]));
}

export async function createCompanyAction(form: FormData): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await createCompany(actorId, detailsFrom(form));
  if (!result.ok) {
    if (result.error === "invalid") {
      return { ok: false, error: t("company.error.check_fields"), fields: detailsFieldMessages(result.errors) };
    }
    return { ok: false, error: companyError(result.error) };
  }
  return done(t("company.created"));
}

function detailsFieldMessages(errors: Partial<Record<DetailsField, string>>): FieldErrors {
  return Object.fromEntries(
    Object.entries(errors).map(([field, code]) => [field, detailsFieldMessage(field as DetailsField, code!)]),
  );
}

export async function saveDetailsAction(form: FormData): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await updateDetails(actorId, detailsFrom(form));
  if (!result.ok) {
    if (result.error === "invalid" && "errors" in result) {
      return { ok: false, error: t("company.error.check_fields"), fields: detailsFieldMessages(result.errors) };
    }
    return { ok: false, error: companyError(result.error) };
  }
  return done(result.changed.length === 0 ? t("company.details.unchanged") : t("company.details.saved"));
}

export async function saveRuleAction(form: FormData): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await updateRule(actorId, {
    thresholdAed: text(form, "thresholdAed"),
    approverId: text(form, "approverId"),
  });
  if (!result.ok) {
    if (result.error === "invalid_threshold" || result.error === "threshold_too_large") {
      return { ok: false, error: t("company.error.check_fields"), fields: { thresholdAed: companyError(result.error) } };
    }
    return { ok: false, error: companyError(result.error) };
  }
  return done(t("company.rule.saved"));
}

export async function setFlagAction(flag: string, value: boolean): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  if (!isRuleFlag(flag)) return { ok: false, error: t("company.error.generic") };
  const result = await setRuleFlag(actorId, flag, value);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  return done();
}

const ADDRESS_KEYS: AddressField[] = [
  "label",
  "addressLine",
  "emirate",
  "areaId",
  "attnName",
  "attnPhone",
  "accessPoint",
  "accessFrom",
  "accessUntil",
  "loadLimit",
];

function addressFrom(form: FormData): Partial<Record<AddressField, string>> {
  return Object.fromEntries(ADDRESS_KEYS.map((key) => [key, text(form, key)]));
}

function addressFieldMessages(errors: Partial<Record<AddressField, string>>): FieldErrors {
  return Object.fromEntries(
    Object.entries(errors).map(([field, code]) => [field, addressFieldMessage(field as AddressField, code!)]),
  );
}

export async function saveAddressAction(form: FormData): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const id = text(form, "addressId");
  const result = id ? await updateAddress(actorId, id, addressFrom(form)) : await addAddress(actorId, addressFrom(form));
  if (!result.ok) {
    if (result.error === "invalid" && "errors" in result) {
      return { ok: false, error: t("company.error.check_fields"), fields: addressFieldMessages(result.errors) };
    }
    if (result.error === "area_mismatch") {
      return { ok: false, error: t("company.error.check_fields"), fields: { areaId: companyError(result.error) } };
    }
    return { ok: false, error: companyError(result.error) };
  }
  return done(id ? t("company.address.saved") : t("company.address.added"));
}

export async function archiveAddressAction(addressId: string): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await archiveAddress(actorId, addressId);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  return done(t("company.address.archived"));
}

export async function setDefaultAddressAction(addressId: string): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await setDefaultAddress(actorId, addressId);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  return done(t("company.address.default_set"));
}

export async function inviteAction(form: FormData): Promise<InviteActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut() as InviteActionResult;
  const result = await inviteMember(actorId, {
    fullName: text(form, "fullName"),
    email: text(form, "email"),
    role: text(form, "role"),
    monthlyLimitAed: text(form, "monthlyLimitAed"),
  });
  if (!result.ok) {
    if (result.error === "invalid" && "errors" in result) {
      return {
        ok: false,
        error: t("company.error.check_fields"),
        fields: Object.fromEntries(
          Object.entries(result.errors).map(([field, code]) => [field, inviteFieldMessage(field, code!)]),
        ),
      };
    }
    return { ok: false, error: companyError(result.error) };
  }
  revalidatePath(PATH);
  return { ok: true, acceptUrl: result.acceptUrl, emailed: result.emailed, email: text(form, "email").trim().toLowerCase() };
}

export async function resendInviteAction(inviteId: string): Promise<InviteActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut() as InviteActionResult;
  const result = await resendInvite(actorId, inviteId);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  revalidatePath(PATH);
  return { ok: true, acceptUrl: result.acceptUrl, emailed: result.emailed, email: "" };
}

export async function revokeInviteAction(inviteId: string): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await revokeInvite(actorId, inviteId);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  return done(t("company.team.invite_revoked"));
}

export async function changeSeatAction(form: FormData): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await changeSeat(actorId, text(form, "memberId"), {
    role: text(form, "role"),
    monthlyLimitAed: text(form, "monthlyLimitAed"),
  });
  if (!result.ok) {
    if (result.error === "invalid" && "errors" in result) {
      return {
        ok: false,
        error: t("company.error.check_fields"),
        fields: Object.fromEntries(
          Object.entries(result.errors).map(([field, code]) => [field, seatFieldMessage(field, code!)]),
        ),
      };
    }
    return { ok: false, error: companyError(result.error) };
  }
  return done(t("company.team.seat_saved"));
}

export async function deactivateAction(memberId: string): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await deactivateMember(actorId, memberId);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  return done(t("company.team.deactivated"));
}

export async function leaveAction(): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await leaveCompany(actorId);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  return done(t("company.team.left"));
}

// ── Approvals ────────────────────────────────────────────────────────────────

export async function approveAction(approvalId: string): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await approveRequest(actorId, approvalId);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  if (result.outcome === "approved") {
    revalidatePath(`/enquiry/${result.enquiryId}`);
    revalidatePath("/account/enquiries");
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/quotes");
  }
  revalidatePath(`${PATH}/approvals/${approvalId}`);
  return done(t("company.approval.approved"));
}

export async function queryAction(approvalId: string, note: string): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await queryRequest(actorId, approvalId, note);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  revalidatePath(`${PATH}/approvals/${approvalId}`);
  return done(t("company.approval.queried"));
}

export async function answerAction(approvalId: string, answer: string): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await answerQuery(actorId, approvalId, answer);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  revalidatePath(`${PATH}/approvals/${approvalId}`);
  return done(t("company.approval.answered"));
}

export async function withdrawAction(approvalId: string): Promise<CompanyActionResult> {
  const actorId = await who();
  if (!actorId) return signedOut();
  const result = await withdrawRequest(actorId, approvalId);
  if (!result.ok) return { ok: false, error: companyError(result.error) };
  revalidatePath(`${PATH}/approvals/${approvalId}`);
  return done(t("company.approval.withdrawn"));
}
