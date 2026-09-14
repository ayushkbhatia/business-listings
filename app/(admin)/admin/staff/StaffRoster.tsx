"use client";

import { useMemo, useState } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { DataTable, TableToolbar, Tabs, type Column, type RowMenuItem } from "@/components/structure";
import type { StaffRole } from "@/lib/auth/roles";
import { t } from "@/lib/i18n";
import type { StaffActionResult } from "./actions";
import { changeRole, deactivate, resend, revoke } from "./actions";
import { DecisionDialog, HandoverLink, RoleDelta, RolePicker, roleLabel } from "./StaffDialogs";

/**
 * Board 4i — the staff table.
 *
 * Every string that depends on the clock arrives formatted from the server, so
 * "4 min ago" is the same text on both sides of hydration.
 *
 * **The table states its own completeness** (`B10`, criterion 9). The render
 * said "9 staff" over five rows with no marker; a reader could not tell a whole
 * list from a page of one. The roster query is uncapped, so the line above the
 * table can say "all" and mean it, and it counts people and invitations
 * separately because an invitation is not yet a person with a role.
 *
 * **A refusal the service would make is shown before the click.** The last ops
 * lead and your own row carry no role control, and the row says why; the
 * service refuses both regardless (`refuseRosterChange`), so this is a courtesy
 * and never the rule.
 */

export type RosterRow =
  | {
      kind: "member";
      id: string;
      name: string;
      email: string | null;
      role: StaffRole;
      decisions: string;
      lastActive: string;
      /** Moss for activity inside the hour, muted otherwise. Never the only signal: the words say it. */
      recent: boolean;
      suspended: boolean;
      isSelf: boolean;
      lastOpsLead: boolean;
    }
  | {
      kind: "invite";
      id: string;
      email: string;
      role: StaffRole;
      state: "pending" | "expired";
      /** "Invitation pending · expires in 2 d" or "Invitation expired 3 d ago". */
      stateLabel: string;
      invitedBy: string;
      /** "Resend available in 12 min", or null when it is available now. */
      resendNote: string | null;
    }
  | {
      kind: "former";
      id: string;
      name: string;
      email: string | null;
      deactivated: string;
      decisions: string;
    };

type Dialog =
  | { kind: "role"; row: Extract<RosterRow, { kind: "member" }> }
  | { kind: "deactivate"; row: Extract<RosterRow, { kind: "member" }> }
  | { kind: "resend"; row: Extract<RosterRow, { kind: "invite" }> }
  | { kind: "revoke"; row: Extract<RosterRow, { kind: "invite" }> };

export interface StaffRosterProps {
  members: readonly Extract<RosterRow, { kind: "member" }>[];
  invites: readonly Extract<RosterRow, { kind: "invite" }>[];
  former: readonly Extract<RosterRow, { kind: "former" }>[];
  /** Whether this viewer may change anything. A non-ops seat reads. */
  canManage: boolean;
  windowDays: number;
  inviteHours: number;
}

export function StaffRoster({ members, invites, former, canManage, windowDays, inviteHours }: StaffRosterProps) {
  const [tab, setTab] = useState<"current" | "former">("current");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [nextRole, setNextRole] = useState<StaffRole | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<StaffActionResult, { ok: true }> | null>(null);

  const rows: RosterRow[] = useMemo(
    () => (tab === "current" ? [...members, ...invites] : [...former]),
    [tab, members, invites, former],
  );

  function open(next: Dialog) {
    setDone(null);
    setRoleError(null);
    setNextRole(null);
    setDialog(next);
  }

  function finish(result: Extract<StaffActionResult, { ok: true }>) {
    setDialog(null);
    setDone(result);
  }

  const columns: Column<RosterRow>[] = [
    {
      key: "person",
      header: t("admin.staff.col.staff"),
      render: (row) => (
        <div className="flex min-w-0 max-w-[20rem] flex-col gap-0.5 py-1">
          <span className="truncate text-body-sm text-ink">
            {row.kind === "invite" ? row.email : row.name}
          </span>
          {row.kind !== "invite" && row.email ? (
            <span className="truncate font-mono text-caption text-body">{row.email}</span>
          ) : null}
          {row.kind === "invite" ? (
            <span className={row.state === "expired" ? "text-caption text-bad-ink" : "text-caption text-warn-ink"}>
              {row.stateLabel}
            </span>
          ) : null}
          {row.kind === "member" && (row.isSelf || row.lastOpsLead || row.suspended) ? (
            <span className="text-caption text-body">
              {[
                row.isSelf ? t("admin.staff.note.self") : null,
                row.lastOpsLead ? t("admin.staff.note.last_ops_lead") : null,
                row.suspended ? t("admin.staff.note.suspended") : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
          {row.kind === "invite" && row.resendNote ? (
            <span className="text-caption text-body">{row.resendNote}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "role",
      header: tab === "current" ? t("admin.staff.col.role") : t("admin.staff.col.deactivated"),
      width: "8rem",
      render: (row) =>
        row.kind === "former" ? (
          <span className="text-body-sm text-body">{row.deactivated}</span>
        ) : (
          <StatusBadge tone={row.role === "staff_ops_lead" ? "info" : "neutral"} shape="chip" size="sm">
            {roleLabel(row.role)}
          </StatusBadge>
        ),
    },
    {
      key: "decisions",
      header: t("admin.staff.col.decisions", { days: windowDays }),
      width: "9.5rem",
      numeric: true,
      hideBelow: "sm",
      render: (row) => (row.kind === "invite" ? "—" : row.decisions),
    },
    ...(tab === "current"
      ? [
          {
            key: "active",
            header: t("admin.staff.col.last_active"),
            width: "8.5rem",
            hideBelow: "md" as const,
            render: (row: RosterRow) =>
              row.kind === "member" ? (
                <span className={row.recent ? "text-ok-ink" : "text-body"}>{row.lastActive}</span>
              ) : row.kind === "invite" ? (
                <span className="text-body">{t("admin.staff.never")}</span>
              ) : null,
          },
        ]
      : []),
  ];

  const rowAction = (row: RosterRow) => {
    if (!canManage) return null;
    if (row.kind === "member") {
      if (row.isSelf || row.suspended || row.lastOpsLead) return null;
      return { label: t("admin.staff.change_role"), onSelect: () => open({ kind: "role", row }) };
    }
    if (row.kind === "invite") {
      if (row.resendNote) return null;
      return { label: t("admin.staff.resend"), onSelect: () => open({ kind: "resend", row }) };
    }
    return null;
  };

  const rowMenu = (row: RosterRow): RowMenuItem[] => {
    if (!canManage) return [];
    if (row.kind === "member" && !row.isSelf && !row.lastOpsLead) {
      return [
        {
          key: "deactivate",
          label: t("admin.staff.deactivate"),
          destructive: true,
          onSelect: () => open({ kind: "deactivate", row }),
        },
      ];
    }
    if (row.kind === "invite") {
      return [
        {
          key: "revoke",
          label: t("admin.staff.revoke"),
          destructive: true,
          onSelect: () => open({ kind: "revoke", row }),
        },
      ];
    }
    return [];
  };

  /*
     A non-ops seat is not shown invitations, so it is not told a count of
     them. "0 invitations" to a moderator while three are outstanding is the
     same lie as the render's "9 staff" over five rows, pointed the other way.
  */
  const completeness = !canManage
    ? t("admin.staff.showing_limited", { count: members.length })
    : tab === "current"
      ? t("admin.staff.showing_current", {
          count: members.length + invites.length,
          total: members.length + invites.length,
          staff: t("admin.staff.count.staff", { count: members.length }),
          invites: t("admin.staff.count.invites", { count: invites.length }),
        })
      : t("admin.staff.showing_former", { count: former.length });

  return (
    <div className="flex flex-col gap-3">
      {done ? (
        <Alert tone="ok" live="polite">
          <div className="flex flex-col gap-3">
            <span>{done.message}</span>
            {done.link ? <HandoverLink link={done.link} /> : null}
          </div>
        </Alert>
      ) : null}

      <div>
        <TableToolbar
          actions={
            <p className="text-caption text-body" aria-live="polite">
              {completeness}
            </p>
          }
        >
          {canManage ? (
            <Tabs
              label={t("admin.staff.tabs_label")}
              active={tab}
              onChange={(key) => setTab(key === "former" ? "former" : "current")}
              items={[
                { key: "current", label: t("admin.staff.tab.current"), badge: members.length + invites.length },
                { key: "former", label: t("admin.staff.tab.former"), badge: former.length },
              ]}
            />
          ) : (
            <p className="text-body-sm text-ink">{t("admin.staff.tab.current")}</p>
          )}
        </TableToolbar>
        <DataTable
          caption={tab === "current" ? t("admin.staff.caption_current") : t("admin.staff.caption_former")}
          columns={columns}
          rows={rows}
          rowKey={(row) => `${row.kind}:${row.id}`}
          rowTone={(row) =>
            row.kind === "invite" && row.state === "expired"
              ? "attention"
              : row.kind === "member" && row.suspended
                ? "blocked"
                : "default"
          }
          {...(canManage
            ? {
                rowAction,
                rowMenu,
                rowMenuLabel: (row: RosterRow) =>
                  t("admin.staff.row_menu", { name: row.kind === "invite" ? row.email : row.name }),
                actionsHeader: t("admin.staff.col.actions"),
              }
            : {})}
          empty={
            <div className="text-center">
              <p className="text-body-sm text-body">
                {tab === "current" ? t("admin.staff.empty_current.title") : t("admin.staff.empty_former.title")}
              </p>
              <p className="mx-auto mt-1 max-w-prose text-caption text-body">
                {tab === "current" ? t("admin.staff.empty_current.body") : t("admin.staff.empty_former.body")}
              </p>
            </div>
          }
        />
      </div>

      {/* ── Change role ─────────────────────────────────────────────────── */}
      <DecisionDialog
        open={dialog?.kind === "role"}
        onClose={() => setDialog(null)}
        title={dialog?.kind === "role" ? t("admin.staff.role_title", { name: dialog.row.name }) : ""}
        description={
          dialog?.kind === "role"
            ? t("admin.staff.role_description", { role: roleLabel(dialog.row.role) })
            : ""
        }
        confirmLabel={t("admin.staff.change_role")}
        ready={dialog?.kind === "role" && nextRole !== null && nextRole !== dialog.row.role}
        onFieldError={(field, message) => setRoleError(field === "role" ? message : null)}
        onSubmit={(reason) => {
          const form = new FormData();
          form.set("userId", dialog?.kind === "role" ? dialog.row.id : "");
          form.set("role", nextRole ?? "");
          form.set("reason", reason);
          return changeRole(form);
        }}
        onDone={finish}
      >
        {dialog?.kind === "role" ? (
          <>
            <RolePicker value={nextRole} onChange={setNextRole} current={dialog.row.role} error={roleError} />
            {nextRole && nextRole !== dialog.row.role ? (
              <RoleDelta from={dialog.row.role} to={nextRole} />
            ) : null}
          </>
        ) : null}
      </DecisionDialog>

      {/* ── Deactivate ──────────────────────────────────────────────────── */}
      <DecisionDialog
        open={dialog?.kind === "deactivate"}
        onClose={() => setDialog(null)}
        title={dialog?.kind === "deactivate" ? t("admin.staff.deactivate_title", { name: dialog.row.name }) : ""}
        description={t("admin.staff.deactivate_description")}
        confirmLabel={t("admin.staff.deactivate")}
        destructive
        onSubmit={(reason) => {
          const form = new FormData();
          form.set("userId", dialog?.kind === "deactivate" ? dialog.row.id : "");
          form.set("reason", reason);
          return deactivate(form);
        }}
        onDone={finish}
      >
        {dialog?.kind === "deactivate" ? <RoleDelta from={dialog.row.role} to={null} /> : null}
      </DecisionDialog>

      {/* ── Resend ──────────────────────────────────────────────────────── */}
      <DecisionDialog
        open={dialog?.kind === "resend"}
        onClose={() => setDialog(null)}
        title={t("admin.staff.resend_title")}
        description={
          dialog?.kind === "resend"
            ? t("admin.staff.resend_description", { email: dialog.row.email, hours: inviteHours })
            : ""
        }
        confirmLabel={t("admin.staff.resend")}
        onSubmit={(reason) => {
          const form = new FormData();
          form.set("inviteId", dialog?.kind === "resend" ? dialog.row.id : "");
          form.set("reason", reason);
          return resend(form);
        }}
        onDone={finish}
      />

      {/* ── Revoke ──────────────────────────────────────────────────────── */}
      <DecisionDialog
        open={dialog?.kind === "revoke"}
        onClose={() => setDialog(null)}
        title={t("admin.staff.revoke_title")}
        description={
          dialog?.kind === "revoke" ? t("admin.staff.revoke_description", { email: dialog.row.email }) : ""
        }
        confirmLabel={t("admin.staff.revoke")}
        destructive
        onSubmit={(reason) => {
          const form = new FormData();
          form.set("inviteId", dialog?.kind === "revoke" ? dialog.row.id : "");
          form.set("reason", reason);
          return revoke(form);
        }}
        onDone={finish}
      />
    </div>
  );
}
