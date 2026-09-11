"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/display";
import {
  ServiceProfileFields,
  type SectorOption,
  type ServiceProfileValue,
} from "@/components/domain/ServiceProfileFields";
import { HEADLINE_MAX } from "@/lib/onboarding/service-profile";
import { formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SaveServiceResult } from "./service-actions";

/**
 * Board `2c-s` — the services field set on the profile step, with its autosave.
 *
 * The fields themselves live in `components/domain/ServiceProfileFields`, which
 * the dashboard mirror mounts too. This is only the save behaviour, and it is
 * here rather than in the shared component precisely so the shared component can
 * be shared: onboarding autosaves as you type and the dashboard saves a form, so
 * a component that owned either could not serve both — which AC7 forbids.
 *
 * Autosave is debounced and **blocked while the one-liner is over its cap**, so
 * the counter turning amber is not decoration: nothing is written until it is
 * back under. Saving a truncated version would be the silent conversion every
 * board on this track refuses.
 */

const AUTOSAVE_MS = 900;

export function ServiceProfileSection({
  initial,
  chips,
  save,
  search,
  grouped = false,
}: {
  initial: ServiceProfileValue;
  chips: readonly SectorOption[];
  save: (formData: FormData) => Promise<SaveServiceResult>;
  search: (query: string) => Promise<SectorOption[]>;
  grouped?: boolean;
}) {
  const [value, setValue] = useState<ServiceProfileValue>(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const first = useRef(true);

  const over = value.headline.trim().length > HEADLINE_MAX;

  useEffect(() => {
    // Nothing to save on mount — the values came from the row.
    if (first.current) {
      first.current = false;
      return;
    }
    if (over) return;

    const timer = setTimeout(() => {
      const form = new FormData();
      form.set("headline", value.headline);
      form.set("servicesOffered", value.servicesOffered.join("\n"));
      form.set("sectorsServed", value.sectorsServed.join("\n"));

      void save(form).then((result) => {
        if (result.ok) {
          setError(null);
          setSavedAt(result.savedAt);
        } else {
          setError(result.error);
        }
      });
    }, AUTOSAVE_MS);

    return () => clearTimeout(timer);
  }, [value, over, save]);

  const onSearch = useCallback((query: string) => search(query), [search]);

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="bad">{error}</Alert>}

      <ServiceProfileFields
        value={value}
        onChange={setValue}
        chips={chips}
        search={onSearch}
        grouped={grouped}
      />

      {/* Polite, because it changes while somebody is typing beside it. */}
      <p aria-live="polite" className="text-caption text-faint">
        {savedAt ? t("shell.saved", { when: formatRelative(new Date(savedAt)) }) : ""}
      </p>
    </div>
  );
}
