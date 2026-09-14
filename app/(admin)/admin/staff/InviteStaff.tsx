"use client";

import { useState } from "react";
import { Button } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { StaffActionResult } from "./actions";
import { invite } from "./actions";
import { HandoverLink, InviteDialog } from "./StaffDialogs";

/**
 * The page header's "Invite staff". Board 4i.
 *
 * Its own dialog and its own confirmation, because the confirmation is where
 * the link lives when the email did not go — and a link that appeared in a
 * banner somewhere else on the page, after the dialog closed, is a link nobody
 * notices before they navigate away.
 */
export function InviteStaff({ domains, hours }: { domains: string; hours: number }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Extract<StaffActionResult, { ok: true }> | null>(null);

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("admin.staff.invite")}</Button>

      <InviteDialog
        open={open}
        onClose={() => setOpen(false)}
        onDone={(result) => {
          setOpen(false);
          setDone(result);
        }}
        action={invite}
        domains={domains}
        hours={hours}
      />

      <Modal
        open={done !== null}
        onClose={() => setDone(null)}
        title={t("admin.staff.invite_sent_title")}
        description={done?.message ?? ""}
        closeLabel={t("overlay.close")}
        size="sm"
        footer={<Button onClick={() => setDone(null)}>{t("admin.staff.done")}</Button>}
      >
        {done?.link ? <HandoverLink link={done.link} /> : null}
      </Modal>
    </>
  );
}
