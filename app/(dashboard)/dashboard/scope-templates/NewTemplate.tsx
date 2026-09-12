"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, Input, Label, Select } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { CreateResult } from "./actions";

/**
 * New from a family — board `3h-s` B2.
 *
 * The family decides which rows exist; the template pre-fills nothing until the
 * seller types it, which is the board's own wording: *starts from a
 * `ScopeSheetFamily`, pre-filling nothing but the shape.*
 */
export function NewTemplate({
  families,
  create,
}: {
  families: readonly { id: string; name: string }[];
  create: (formData: FormData) => Promise<CreateResult>;
}) {
  const router = useRouter();
  const ids = useId();
  const [failure, setFailure] = useState<{ error: string; fix: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onCreate(formData: FormData): void {
    setFailure(null);
    startTransition(async () => {
      const made = await create(formData);
      if (!made.ok) {
        setFailure(made);
        return;
      }
      router.push(`/dashboard/scope-templates/${made.slug}`);
    });
  }

  return (
    <form action={onCreate} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-name`} hint={t("scope_template.new_name_hint")}>
          {t("scope_template.new_name")}
        </Label>
        <Input id={`${ids}-name`} name="name" autoComplete="off" />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-family`}>{t("scope_template.new_family")}</Label>
        <Select
          id={`${ids}-family`}
          name="familyId"
          options={families.map((family) => ({ value: family.id, label: family.name }))}
          placeholder={t("scope_template.new_family")}
        />
      </div>

      <div>
        <Button type="submit" size="md" disabled={pending}>
          {t("scope_template.create")}
        </Button>
      </div>

      {failure && (
        <Alert tone="bad" live="assertive" fix={failure.fix}>
          {failure.error}
        </Alert>
      )}
    </form>
  );
}
