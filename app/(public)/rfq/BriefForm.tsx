"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ServiceBriefComposer,
  type BriefAreaOption,
  type BriefValue,
} from "@/components/domain/ServiceBriefComposer";
import { EMPTY_BRIEF, matchState, parseSiteValue, type BriefField } from "@/lib/enquiry/service-brief";
import type { BriefPreview } from "@/lib/enquiry/service-brief-server";
import { confirmBriefAttachment, previewServiceBrief, submitServiceBrief } from "./brief-actions";
import { routeUnmatched } from "./actions";
import {
  briefDraftScope,
  briefDraftServerSnapshot,
  briefDraftSnapshot,
  saveBriefDraft,
  subscribeBriefDraft,
  type BriefDraft,
} from "./brief-draft";

/**
 * Board `1h-s` — the brief, bound to its draft, its preview and its send.
 *
 * Send first; then, only once the brief exists, each chosen file goes straight
 * to storage on the signature the send returned and is confirmed. Whatever
 * happens to the files, the buyer lands on their enquiry — a failed upload adds
 * `attachment=failed`, which the tracking page reads out. The same order, for
 * the same reasons, as the storefront's service form.
 */
export function BriefForm({
  categoryId,
  kind,
  subcategoryName,
  family,
  areas,
  initial,
  pinned,
  service,
  pinnedDeliverable,
  initialPreview,
  firstReply,
  askForContact,
  unpinHref,
}: {
  categoryId: string;
  kind: string | null;
  subcategoryName: string;
  family: string;
  areas: readonly BriefAreaOption[];
  /** Seeded answers — the site from `1f-s`, the engagement from a service page. */
  initial: BriefValue;
  pinned: { slug: string; name: string } | null;
  service: string | null;
  /** Whether the named firm would receive it now. Read once, on the server. */
  pinnedDeliverable: boolean;
  /** The match for the seeded site, so a warm arrival paints its rail at once. */
  initialPreview: BriefPreview | null;
  firstReply: string | null;
  askForContact: boolean;
  unpinHref: string | null;
}) {
  const router = useRouter();
  const scope = briefDraftScope(categoryId, pinned?.slug ?? null);

  /*
     The draft is the store, not a copy of it, for the reason `RfqComposer`
     records: a `useState` seeded from the store reads the server's empty
     snapshot during hydration and never sees the restore.
  */
  const stored = useSyncExternalStore(subscribeBriefDraft, briefDraftSnapshot, briefDraftServerSnapshot);
  const draft = stored && stored.scope === scope ? stored : null;
  const value: BriefValue = useMemo(
    // Over the empty value, so a draft written before a field existed still
    // hands the composer every key it reads.
    () => (draft ? { ...EMPTY_BRIEF, ...draft.value, site: draft.value.site || initial.site } : initial),
    [draft, initial],
  );
  const widen = draft?.widen ?? false;
  const warned = draft?.warned ?? false;

  const write = useCallback(
    (patch: Partial<Omit<BriefDraft, "scope">>) => {
      const current = briefDraftSnapshot();
      const base: BriefDraft =
        current && current.scope === scope
          ? current
          : { scope, value: initial, widen: false, fileNames: [], warned: false };
      saveBriefDraft({ ...base, ...patch });
    },
    [scope, initial],
  );

  const [files, setFiles] = useState<File[]>([]);
  /*
     Each preview remembers the answers it was for. Whether the rail is current
     is then a comparison, not a flag an effect has to set and unset.
  */
  const [matched, setMatched] = useState<{ key: string; preview: BriefPreview } | null>(
    initialPreview ? { key: `${initial.site}|false|`, preview: initialPreview } : null,
  );
  const [routed, setRouted] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);
  const [fields, setFields] = useState<Partial<Record<BriefField, string>>>({});

  const areaEmirate = useCallback(
    (areaId: string) => (areas.find((area) => area.id === areaId)?.emirate as never) ?? null,
    [areas],
  );
  const site = parseSiteValue(value.site, areaEmirate);

  /*
     Re-matched when the answer that decides the match changes: the site, the
     widening, and the engagement — which only reorders the three names, but
     the names on screen should be the three the send would pick.
  */
  const key = `${value.site}|${widen}|${value.engagement}`;
  const siteKnown = site !== null;
  useEffect(() => {
    if (pinned || !siteKnown || matched?.key === key) return;
    let cancelled = false;
    void previewServiceBrief({ categoryId, site: value.site, widen, engagement: value.engagement }).then(
      (preview) => {
        if (!cancelled) setMatched({ key, preview });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [categoryId, key, matched?.key, pinned, siteKnown, value.site, value.engagement, widen]);
  const previewing = !pinned && siteKnown && matched?.key !== key;
  const preview = matched?.preview ?? null;

  const state = matchState({
    site,
    pinned: Boolean(pinned),
    scope: widen ? "emirate" : "area",
    count: pinned ? (pinnedDeliverable ? 1 : 0) : (preview?.count ?? 0),
    emirateCount: preview?.emirateCount ?? null,
  });

  function send() {
    setError(undefined);
    setFields({});
    startTransition(async () => {
      const sent = await submitServiceBrief({
        categoryId,
        kind,
        site: value.site,
        widen,
        building: value.building,
        description: value.description,
        engagement: value.engagement,
        cadence: value.cadence,
        startMode: value.startMode,
        startsOn: value.startsOn,
        scale: value.scale,
        pinned: pinned?.slug ?? null,
        service,
        attachments: files.map((file) => ({ filename: file.name, type: file.type, bytes: file.size })),
        contactPhone: value.contactPhone,
        contactName: value.contactName,
      });

      if (!sent.ok) {
        setError(sent.error);
        setFields(sent.fields);
        return;
      }

      let next = sent.next;
      let failed = files.length > 0 && sent.uploads.length === 0;
      // Signed in the order the files were posted, so the index is the file.
      for (const [index, upload] of sent.uploads.entries()) {
        const file = files[index];
        const delivered =
          file !== undefined &&
          (await put(file, upload.url)) &&
          (
            await confirmBriefAttachment({
              enquiryId: sent.enquiryId,
              path: upload.path,
              filename: upload.filename,
              claimToken: sent.claimToken,
            })
          ).ok;
        if (!delivered) failed = true;
      }
      if (failed) next = withFailedAttachment(next);

      // Sent. Leaving the draft would refill the next brief with this one.
      saveBriefDraft(null);
      router.push(next);
    });
  }

  return (
    <ServiceBriefComposer
      subcategoryName={subcategoryName}
      family={family}
      areas={areas}
      value={value}
      onChange={(next) => write({ value: next, ...(next.site !== value.site ? { widen: false } : {}) })}
      files={files}
      onAddFiles={(chosen) => {
        const all = [...files, ...chosen];
        setFiles(all);
        write({ fileNames: all.map((file) => file.name) });
      }}
      onRemoveFile={(index) => {
        const all = files.filter((_, i) => i !== index);
        setFiles(all);
        write({ fileNames: all.map((file) => file.name) });
      }}
      lostFiles={draft?.fileNames ?? []}
      attachWarned={warned}
      onAttachWarned={() => write({ warned: true })}
      rail={{
        state,
        names: preview?.names ?? [],
        scope: widen || !site?.areaId ? "emirate" : "area",
        pinnedName: pinned?.name ?? null,
        pending: previewing,
        routed,
      }}
      onWiden={(next) => write({ widen: next })}
      onRouteUnmatched={() =>
        startTransition(async () => {
          await routeUnmatched({
            categoryId,
            requirement: value.description,
            lines: [],
            emirate: site?.emirate ?? null,
          });
          setRouted(true);
        })
      }
      unpinHref={unpinHref}
      firstReply={firstReply}
      askForContact={askForContact}
      focusDescription={Boolean(initial.site) && !initial.description && !draft}
      busy={pending}
      fieldErrors={fields}
      onSubmit={send}
      {...(error ? { error } : {})}
    />
  );
}

/** One PUT to the signed URL. A network failure is `false`, not a throw. */
async function put(file: File, url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "PUT", headers: { "content-type": file.type }, body: file });
    return response.ok;
  } catch {
    return false;
  }
}

function withFailedAttachment(next: string): string {
  const url = new URL(next, window.location.origin);
  url.searchParams.set("attachment", "failed");
  return `${url.pathname}${url.search}`;
}
