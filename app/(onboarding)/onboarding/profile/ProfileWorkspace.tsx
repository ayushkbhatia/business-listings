"use client";

import { useState } from "react";
import type { CategoryAllowance } from "@/lib/onboarding/categories";
import type { ProfileCategory } from "@/lib/onboarding/profile";
import type { StrengthItem } from "@/lib/metrics/profile-strength";
import type { AddCategoryResult } from "@/lib/onboarding/categories";
import type { ContinueResult, SaveFieldResult } from "./actions";
import { ProfileForm } from "./ProfileForm";
import { ProfilePreview, type PreviewRecord } from "./ProfilePreview";
import { StrengthMeter } from "./StrengthMeter";

/**
 * The two columns, and the one piece of state they share.
 *
 * Board 2c's premise is that every field on the left has a visible consequence
 * in the rail on the right. That needs the draft to live above both — the form
 * owns the inputs, the preview reads what they currently say, and neither knows
 * about the other.
 *
 * Only the fields the card actually renders are lifted. The team size and the
 * category chips do not appear on a search result, so pushing them through here
 * would be state travelling for nothing.
 */
export function ProfileWorkspace({
  record,
  strength,
  items,
  threshold,
  lift,
  form,
}: {
  record: PreviewRecord;
  strength: number;
  items: readonly StrengthItem[];
  threshold: number;
  lift: { multiple: number; threshold: number } | null;
  form: {
    tradeName: string;
    displayName: string;
    description: string;
    establishedYear: number | null;
    teamSize: string | null;
    primaryCategoryLabel: string;
    extras: readonly ProfileCategory[];
    allowance: CategoryAllowance;
    upgrade: { planName: string; more: number | null } | null;
    addable: readonly { value: string; label: string }[];
    teamSizes: readonly { value: string; label: string }[];
    saveAction: (formData: FormData) => Promise<SaveFieldResult>;
    addAction: (formData: FormData) => Promise<AddCategoryResult>;
    removeAction: (formData: FormData) => Promise<{ ok: true }>;
    continueAction: () => Promise<ContinueResult>;
  };
}) {
  const [draft, setDraft] = useState({
    displayName: record.displayName,
    description: record.description,
    establishedYear: record.establishedYear,
  });

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-8">
      <div className="min-w-0 flex-1">
        <ProfileForm {...form} onDraft={setDraft} />
      </div>

      <div className="flex w-full shrink-0 flex-col gap-5 lg:w-[29.375rem]">
        <ProfilePreview record={{ ...record, ...draft }} />
        <StrengthMeter strength={strength} items={items} threshold={threshold} lift={lift} />
      </div>
    </div>
  );
}
