"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/primitives";

/**
 * Board 3j §1 — whose leads to show.
 *
 * A client island for one `onChange`, and it receives strings only. Nothing here
 * calls `t()` and nothing imports `SellerSeat`: `_shell.tsx` opens with
 * `import "server-only"`, so a type import from it would fail the build, and a
 * function handed across the boundary is this repo's most repeated defect.
 *
 * It navigates rather than filtering in place. The scope is part of the URL, so
 * a manager looking at one seat's queue can send that view to them, and the back
 * button undoes the choice.
 */

export interface ScopeOption {
  value: string;
  label: string;
}

export function ScopeFilter({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: readonly ScopeOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      size="sm"
      aria-label={label}
      value={value}
      disabled={pending}
      options={options}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(() => {
          const url = new URL(window.location.href);
          // The tab survives a scope change and the cursor does not: a seller
          // narrowing to their own leads is starting the list again, and
          // carrying page two of somebody else's queue into it would open on a
          // page that no longer exists.
          url.searchParams.delete("cursor");
          if (next === "all") url.searchParams.delete("scope");
          else url.searchParams.set("scope", next);
          router.push(`${url.pathname}${url.search}`);
        });
      }}
    />
  );
}
