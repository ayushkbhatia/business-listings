import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/display";
import { AuditRow } from "@/components/domain/AuditRow";
import { RoleMatrix } from "@/components/domain/RoleMatrix";
import { Panel } from "@/components/structure";
import { buttonClassName } from "@/components/primitives";
import type { Capability } from "@/lib/auth/capabilities";
import { can } from "@/lib/auth/can";
import { RETIRED_STAFF_ROLES, STAFF_ROLES } from "@/lib/auth/roles";
import { requireStaff } from "@/lib/auth/staff";
import { readAuditPage } from "@/lib/audit/log";
import { formatCount, formatCountdown, formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { STAFF_EMAIL_DOMAINS, STAFF_INVITE_HOURS, staffRoleOf } from "@/lib/staff/policy";
import { staffMatrix } from "@/lib/staff/matrix";
import { staffRoster } from "@/lib/staff/roster";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { InviteStaff } from "./InviteStaff";
import { StaffRoster, type RosterRow } from "./StaffRoster";

/**
 * Board 4i — `/admin/staff`. Who can do what, and what they did.
 *
 * Three rules this page keeps that the render did not:
 *
 *   - **Three roles, one retired, and both numbers are data.** The header's
 *     counts read `STAFF_ROLES` and `RETIRED_STAFF_ROLES`; the matrix reads
 *     `CAPABILITIES`. The render's `FLD` column holding "Set verification tier"
 *     is exactly what a hand-drawn matrix ships nine days after the permission
 *     was withdrawn.
 *   - **No "SSO enforced".** There is no single sign-on in this product; staff
 *     sign in with a one-time code like everybody else. The header says what is
 *     true — invitations go only to a staff domain — and nothing else.
 *   - **The table says how much of the list it is** (`B10`).
 *
 * Every staff seat may open it (`staff.read`); only `staff.manage` sees the
 * controls, the invitations and anybody else's workload.
 */

export const dynamic = "force-dynamic";

const SHORT: Record<(typeof STAFF_ROLES)[number], MessageKey> = {
  staff_ops_lead: "staff.role_short.staff_ops_lead",
  staff_moderator: "staff.role_short.staff_moderator",
  staff_finance: "staff.role_short.staff_finance",
};

/** Rows that need a word beside the ticks to be read correctly. */
const NOTES: Partial<Record<Capability, MessageKey>> = {
  "audit.read": "admin.staff.matrix_note.audit_read",
  "business.verification_tier.write": "admin.staff.matrix_note.tier",
  "enquiry.read_other_business": "admin.staff.matrix_note.cross_business",
};

const RECENT_MS = 60 * 60 * 1000;

export default async function StaffPage() {
  const seat = await requireStaff();
  const now = new Date();

  const [roster, badges, recent] = await Promise.all([
    staffRoster(seat.actor, now),
    getAdminNavBadges(seat),
    readAuditPage(seat.actor, {}, { size: 6 }),
  ]);
  if (!roster) notFound();

  const canManage = can(seat.actor, "staff.manage");
  const viewerRole = staffRoleOf(seat.roles);

  const members: Extract<RosterRow, { kind: "member" }>[] = roster.members.map((member) => ({
    kind: "member",
    id: member.id,
    name: member.name ?? member.email ?? "—",
    email: member.email,
    role: member.role,
    decisions: member.decisions === null ? "—" : formatCount(member.decisions),
    lastActive: !member.activityVisible
      ? "—"
      : member.lastActiveAt
        ? formatRelative(member.lastActiveAt, { now })
        : t("admin.staff.not_recorded"),
    recent:
      member.activityVisible &&
      member.lastActiveAt !== null &&
      now.getTime() - member.lastActiveAt.getTime() < RECENT_MS,
    suspended: member.suspended,
    isSelf: member.isSelf,
    lastOpsLead:
      member.role === "staff_ops_lead" && !member.suspended && roster.counts.activeOpsLeads <= 1,
  }));

  const invites: Extract<RosterRow, { kind: "invite" }>[] = roster.invites.map((invite) => ({
    kind: "invite",
    id: invite.id,
    email: invite.email,
    role: invite.role,
    state: invite.state,
    stateLabel:
      invite.state === "pending"
        ? t("admin.staff.invite_pending", { when: formatCountdown(invite.expiresAt, { now }) })
        : t("admin.staff.invite_expired", { when: formatRelative(invite.expiresAt, { now }) }),
    invitedBy: invite.invitedByName ?? "—",
    resendNote: invite.resendAfter
      ? t("admin.staff.resend_after", { when: formatRelative(invite.resendAfter, { now }) })
      : null,
  }));

  const former: Extract<RosterRow, { kind: "former" }>[] = roster.former.map((person) => ({
    kind: "former",
    id: person.id,
    name: person.name ?? person.email ?? "—",
    email: person.email,
    deactivated: formatDate(person.deactivatedAt),
    decisions: formatCount(person.decisions),
  }));

  const matrixGroups = staffMatrix().map((group) => ({
    key: group.key,
    label: t(`admin.staff.matrix_group.${group.key}` as MessageKey),
    rows: group.rows.map((row) => {
      const note = NOTES[row.capability];
      return {
        key: row.capability,
        label: t(`staff.capability.${row.capability}` as MessageKey),
        grants: row.grants,
        ...(note ? { note: t(note) } : {}),
      };
    }),
  }));

  const retired = RETIRED_STAFF_ROLES[0];

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/staff"
      title={t("admin.staff.title")}
      eyebrow={t("admin.staff.eyebrow")}
      meta={
        <span className="text-caption text-body">
          {t("admin.staff.meta", {
            staff: formatCount(roster.counts.staff),
            roles: t("admin.staff.count.roles", { count: roster.counts.roles }),
            retired: t("admin.staff.count.retired", { count: roster.counts.retired }),
            domains: STAFF_EMAIL_DOMAINS.join(", "),
          })}
        </span>
      }
      {...(canManage
        ? { actions: <InviteStaff domains={STAFF_EMAIL_DOMAINS.join(", ")} hours={STAFF_INVITE_HOURS} /> }
        : {})}
    >
      <div className="grid gap-[var(--gutter)] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-[var(--gutter)]">
          {!canManage ? (
            <Alert tone="info">{t("admin.staff.read_only")}</Alert>
          ) : null}

          <StaffRoster
            members={members}
            invites={invites}
            former={former}
            canManage={canManage}
            windowDays={roster.windowDays}
            inviteHours={STAFF_INVITE_HOURS}
          />

          <Panel
            title={t("admin.staff.log_title")}
            description={
              recent?.scope === "own" ? t("admin.staff.log_own") : t("admin.staff.log_all")
            }
            padded={false}
            actions={
              <span className="flex items-center gap-2">
                <Link href="/admin/audit" className={buttonClassName({ variant: "link", size: "sm" })}>
                  {t("admin.staff.log_full")}
                </Link>
                <a
                  href="/admin/audit/export"
                  className={buttonClassName({ variant: "link", size: "sm" })}
                  download
                >
                  {t("admin.staff.log_export")}
                </a>
              </span>
            }
          >
            {recent && recent.entries.length > 0 ? (
              <ul className="m-0 list-none p-0">
                {recent.entries.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    headline={entry.headline}
                    actionLabel={entry.headline}
                    actorName={entry.actorName}
                    subject={entry.subject}
                    subjectName={entry.subjectName}
                    blast={entry.blast}
                    at={formatDateTime(entry.at)}
                    reason={entry.reason}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-body-sm text-body">
                {recent?.scope === "own" ? t("admin.audit.empty_own.title") : t("admin.audit.empty.title")}
              </p>
            )}
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-[var(--gutter)]" aria-label={t("admin.staff.rail")}>
          <Panel
            title={t("admin.staff.matrix_title")}
            description={t("admin.staff.matrix_description")}
            padded={false}
            footer={
              retired ? (
                <p className="text-caption text-body">
                  {t("admin.staff.retired_note", {
                    role: t(`staff.retired_role.${retired.name}` as MessageKey),
                    date: formatDate(new Date(`${retired.retiredOn}T00:00:00+04:00`)),
                    moved: t(`staff.role.${retired.holdersMovedTo}` as MessageKey),
                  })}
                </p>
              ) : undefined
            }
          >
            <RoleMatrix
              caption={t("admin.staff.matrix_caption")}
              capabilityHeader={t("admin.staff.matrix_capability")}
              columns={STAFF_ROLES.map((role) => ({
                key: role,
                short: t(SHORT[role]),
                label: t(`staff.role.${role}` as MessageKey),
              }))}
              groups={matrixGroups}
              grantedLabel={t("admin.staff.granted")}
              deniedLabel={t("admin.staff.denied")}
              {...(viewerRole ? { highlight: viewerRole } : {})}
            />
          </Panel>

          <section
            aria-labelledby="staff-rule-title"
            className="rounded-panel border border-line bg-paper-sunk p-4"
          >
            <h2 id="staff-rule-title" className="text-h3 text-ink">
              {t("admin.staff.rule_title")}
            </h2>
            <p className="mt-1 text-body-sm text-prose">{t("admin.staff.rule_body")}</p>
          </section>
        </aside>
      </div>
    </AdminPage>
  );
}
