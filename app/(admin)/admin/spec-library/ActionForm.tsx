"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import type { SpecActionResult } from "./actions";

/**
 * Board 4e's forms, with somewhere for a refusal to land.
 *
 * The six writes on this screen were plain `<form action={serverAction}>` in a
 * server component, and every refusal inside them was `throw new Error(...)`.
 * That meant the most ordinary mistake on the screen — pressing *Publish* with
 * the reason box empty, which `AuditEvent.reason` being `NOT NULL` guarantees
 * somebody will do — replaced the draft panel with an error boundary and lost
 * the staged work from view.
 *
 * So the actions return `SpecActionResult` and this draws it: the message and
 * its fix in a `bad` Alert, `live="assertive"` because a failed save is the one
 * notice design-system §05.1 lets interrupt. On success it refreshes, since the
 * action has already revalidated the path.
 *
 * The same shape `ScopeFamilies` uses for board `4e-s` on the sibling tab. The
 * children are elements and the action is a server action, which is the only
 * kind of function that crosses this boundary.
 */
export function ActionForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<SpecActionResult>;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<Extract<SpecActionResult, { ok: false }> | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      {failure && (
        <Alert tone="bad" live="assertive" fix={failure.fix}>
          {failure.error}
        </Alert>
      )}
      <form
        className={className}
        action={(formData) => {
          setFailure(null);
          startTransition(async () => {
            const done = await action(formData);
            if (!done.ok) {
              setFailure(done);
              return;
            }
            router.refresh();
          });
        }}
      >
        {children}
      </form>
    </div>
  );
}
