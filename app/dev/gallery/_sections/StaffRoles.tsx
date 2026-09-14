import { AuditTable, type AuditRowData } from "@/app/(admin)/admin/audit/AuditTable";
import { StaffRoster, type RosterRow } from "@/app/(admin)/admin/staff/StaffRoster";
import { AuditRow } from "@/components/domain/AuditRow";
import { RoleMatrix } from "@/components/domain/RoleMatrix";
import { STAFF_ROLES } from "@/lib/auth/roles";
import { describeEntry } from "@/lib/audit/describe";
import { t, type MessageKey } from "@/lib/i18n";
import { staffMatrix } from "@/lib/staff/matrix";
import { Section, States } from "../_kit";

/**
 * Board `4i` — staff, roles and the log, in the states its table names.
 *
 * Synthetic rows, so every state renders on an empty database: typical, an
 * expired invitation, the last ops lead, a suspended account, the read-only
 * view a moderator gets, and the empty tables. No titled `Panel` wraps anything
 * here — a titled panel is a landmark, and the gallery would render each one
 * twice under one name.
 */

type Member = Extract<RosterRow, { kind: "member" }>;
type Invite = Extract<RosterRow, { kind: "invite" }>;
type Former = Extract<RosterRow, { kind: "former" }>;

const MEMBERS: Member[] = [
  {
    kind: "member",
    id: "g-ops",
    name: "Rami Haddad",
    email: "r.haddad@businesslistings.me",
    role: "staff_ops_lead",
    decisions: "418",
    lastActive: "now",
    recent: true,
    suspended: false,
    isSelf: true,
    lastOpsLead: true,
  },
  {
    kind: "member",
    id: "g-mod",
    name: "Sana Iqbal",
    email: "s.iqbal@businesslistings.me",
    role: "staff_moderator",
    decisions: "1,204",
    lastActive: "4 min ago",
    recent: true,
    suspended: false,
    isSelf: false,
    lastOpsLead: false,
  },
  {
    kind: "member",
    id: "g-fin",
    name: "Deepak Nair",
    email: "d.nair@businesslistings.me",
    role: "staff_finance",
    decisions: "42",
    lastActive: "1 d 2 h ago",
    recent: false,
    suspended: true,
    isSelf: false,
    lastOpsLead: false,
  },
];

const INVITES: Invite[] = [
  {
    kind: "invite",
    id: "g-inv-pending",
    email: "m.alrashid@businesslistings.me",
    role: "staff_moderator",
    state: "pending",
    stateLabel: "Invitation pending · expires in 2 d 1 h",
    invitedBy: "Rami Haddad",
    resendNote: "Resend available in 12 min",
  },
  {
    kind: "invite",
    id: "g-inv-expired",
    email: "lapsed.finance@businesslistings.me",
    role: "staff_finance",
    state: "expired",
    stateLabel: "Invitation expired 3 d ago",
    invitedBy: "Rami Haddad",
    resendNote: null,
  },
];

const FORMER: Former[] = [
  {
    kind: "former",
    id: "g-former",
    name: "Field Officer",
    email: "field@businesslistings.me",
    deactivated: "5 Sep 2026",
    decisions: "0",
  },
];

const LOG: AuditRowData[] = [
  {
    id: "g-log-1",
    when: "14 Sep 2026, 12:14",
    subject: "SpecTemplate:clx0valves3",
    subjectName: "Valves & actuators v3",
    reason: "Pressure rating split into PN and class; sellers asked for both.",
    change: [{ field: "version", from: "2", to: "3" }],
    ...pick(describeEntry({ actorName: "R. Haddad", action: "taxonomy_changed", subjectName: null, blastRadius: 8412, blastUnit: "products" })),
  },
  {
    id: "g-log-2",
    when: "14 Sep 2026, 11:02",
    subject: "Subscription:clx0sub299",
    subjectName: "Al Waha Industrial Supplies",
    reason: "Billing error: renewal charged twice on 1 Sep.",
    change: [],
    ...pick(describeEntry({ actorName: "D. Nair", action: "credit_issued", subjectName: null, blastRadius: null, blastUnit: null })),
  },
  {
    id: "g-log-3",
    when: "13 Sep 2026, 09:40",
    subject: "User:00000000-0000-4000-8000-000000000003",
    subjectName: "Field Officer",
    reason: "Field verifier retired by the 5 Sep cut. Offboarded rather than moved to moderation.",
    change: [{ field: "role", from: "staff_field", to: "—" }],
    ...pick(describeEntry({ actorName: "R. Haddad", action: "staff_deactivated", subjectName: null, blastRadius: null, blastUnit: null })),
  },
];

function pick(described: ReturnType<typeof describeEntry>) {
  return { headline: described.headline, blast: described.blast };
}

export function StaffRolesGallery() {
  const groups = staffMatrix().map((group) => ({
    key: group.key,
    label: t(`admin.staff.matrix_group.${group.key}` as MessageKey),
    rows: group.rows.map((row) => ({
      key: row.capability,
      label: t(`staff.capability.${row.capability}` as MessageKey),
      grants: row.grants,
    })),
  }));
  const columns = STAFF_ROLES.map((role) => ({
    key: role,
    short: t(`staff.role_short.${role}` as MessageKey),
    label: t(`staff.role.${role}` as MessageKey),
  }));

  return (
    <Section
      id="staff-roles"
      title="Staff, roles & audit log"
      note="Board 4i. Three roles and one retired; the matrix is CAPABILITIES drawn, the table states its own completeness, and the log reads as consequence."
    >
      <States label="Roster · ops lead, typical" stack>
        <StaffRoster members={MEMBERS} invites={INVITES} former={FORMER} canManage windowDays={30} inviteHours={72} />
      </States>
      <States label="Roster · read-only seat" stack>
        <StaffRoster
          members={MEMBERS.map((m) => ({ ...m, decisions: m.isSelf ? m.decisions : "—", lastActive: m.isSelf ? m.lastActive : "—", recent: m.isSelf && m.recent }))}
          invites={[]}
          former={[]}
          canManage={false}
          windowDays={30}
          inviteHours={72}
        />
      </States>
      <States label="Roster · empty" stack>
        <StaffRoster members={[]} invites={[]} former={[]} canManage windowDays={30} inviteHours={72} />
      </States>

      <States label="Matrix · viewer is a moderator" stack>
        <div className="w-[24rem] rounded-panel border border-line bg-card">
          <RoleMatrix
            caption="What each staff role may do, gallery specimen"
            capabilityHeader={t("admin.staff.matrix_capability")}
            columns={columns}
            groups={groups}
            grantedLabel={t("admin.staff.granted")}
            deniedLabel={t("admin.staff.denied")}
            highlight="staff_moderator"
          />
        </div>
      </States>

      <States label="Log line · blast radius" stack>
        <ul className="m-0 w-full max-w-[48rem] list-none rounded-card border border-line bg-card p-0">
          {LOG.map((row) => (
            <AuditRow
              key={row.id}
              headline={row.headline}
              actionLabel={row.headline}
              actorName=""
              subject={row.subject}
              subjectName={row.subjectName}
              blast={row.blast}
              at={row.when}
              reason={row.reason}
            />
          ))}
        </ul>
      </States>

      <States label="Log · typical" stack>
        <AuditTable rows={LOG} filtered={false} scope="all" />
      </States>
      <States label="Log · filtered to zero" stack>
        <AuditTable rows={[]} filtered scope="all" />
      </States>
      <States label="Log · own rows, none yet" stack>
        <AuditTable rows={[]} filtered={false} scope="own" />
      </States>
    </Section>
  );
}
