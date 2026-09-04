"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, buttonClassName } from "@/components/primitives";
import { Check } from "@/components/primitives/icons";
import type { ShortlistActionResult } from "./actions";

/**
 * "Save for later", on a storefront or a results row.
 *
 * Every string arrives already translated and every href already built. This
 * component calls no `t()` and formats nothing: a client component that
 * formatted a date or a number would render one thing on the server and another
 * in the browser, which is the single most repeated defect in this codebase.
 *
 * A buyer with no account gets a link to sign in, never a disabled button. A
 * control that does nothing and says nothing is the worst of both — the buyer
 * learns neither that the feature exists nor how to reach it.
 */

export interface ShortlistLabels {
  /** "Save for later" — the resting label, and the accessible name unpressed. */
  save: string;
  /** "Saved" — the label once the row exists. */
  saved: string;
  /** "Remove from shortlist" — the tooltip on the pressed state. */
  remove: string;
  /** "Sign in to save". */
  signIn: string;
  /** `/signin?next=…`, with the current path already encoded by the caller. */
  signInHref: string;
}

export interface ShortlistButtonProps {
  businessId: string;
  /** Whether this buyer has already saved this supplier. */
  saved: boolean;
  /** False renders the sign-in link instead of the toggle. */
  signedIn: boolean;
  toggle: (businessId: string, next: boolean) => Promise<ShortlistActionResult>;
  labels: ShortlistLabels;
  size?: "sm" | "md";
  block?: boolean;
}

export function ShortlistButton({
  businessId,
  saved: initiallySaved,
  signedIn,
  toggle,
  labels,
  size = "md",
  block = false,
}: ShortlistButtonProps) {
  const [saved, setSaved] = useState(initiallySaved);
  const [signedOut, setSignedOut] = useState(!signedIn);
  const [pending, startTransition] = useTransition();

  /*
     Signed-out is decided twice, and deliberately.

     The prop covers the ordinary case, so the buyer sees where the control
     leads before spending a press on it. The refusal covers the two cases the
     prop cannot: a session that expired between the render and the press, and a
     storefront served from the route cache, which never knew who was reading
     it. Both land on the same link.
  */
  if (signedOut) {
    return (
      <Link
        href={labels.signInHref}
        className={buttonClassName({ variant: "secondary", size, block })}
      >
        {labels.signIn}
      </Link>
    );
  }

  function press() {
    const next = !saved;
    // Optimistic. A save is one row and the round trip is the only thing slow
    // about it, so the label moves first and the server's answer confirms it.
    setSaved(next);

    startTransition(async () => {
      const result = await toggle(businessId, next);
      if (result.ok) {
        setSaved(result.saved);
        return;
      }
      setSaved(!next);
      if (result.error === "signed_out") setSignedOut(true);
    });
  }

  return (
    <Button
      variant="secondary"
      size={size}
      block={block}
      aria-pressed={saved}
      // The visible label is the accessible name, so the pressed state is
      // carried by aria-pressed rather than by swapping the name underneath a
      // screen reader. "Remove from shortlist" rides on the title, where it
      // tells a mouse what the second press does without renaming the control.
      title={saved ? labels.remove : undefined}
      leadingIcon={saved ? <Check size={13} /> : undefined}
      loading={pending}
      onClick={press}
    >
      {saved ? labels.saved : labels.save}
    </Button>
  );
}
