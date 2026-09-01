"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, FileDrop, Input, Label, Textarea } from "@/components/primitives";
import { Alert, Tag } from "@/components/display";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult, SignResult } from "./actions";

/**
 * Board 4h — the visit report.
 *
 * Three questions, a date, a reason and at least two geotagged photographs.
 * `recordVisit` refuses fewer, and refuses any photograph outside the UAE, and
 * a CHECK constraint refuses it again underneath — so this form's job is to
 * make both refusals impossible to hit by accident rather than to enforce them.
 *
 * ## Where the coordinates come from
 *
 * `navigator.geolocation`, read once per photograph at the moment it is added,
 * not EXIF. That is a deliberate trade and it is worth being honest about what
 * it proves: it says where **the verifier's device is now**, not where the
 * photograph was taken. Phone cameras strip EXIF location often enough that
 * parsing it would fail on most uploads and silently produce reports with no
 * coordinates at all.
 *
 * The verifier is standing in the warehouse when they file this, so the device
 * position is the honest signal available. The alternative — letting them type
 * coordinates — would make the bounding box theatre.
 */

export interface VisitReportFormProps {
  businessId: string;
  businessName: string;
  requestId: string | null;
  today: string;
  signPhoto: (formData: FormData) => Promise<SignResult>;
  recordPhoto: (
    formData: FormData,
  ) => Promise<{ ok: true; mediaId: string } | { ok: false; error: string }>;
  fileReport: (formData: FormData) => Promise<ActionResult>;
}

interface Pending {
  mediaId: string;
  filename: string;
  lat: number;
  lng: number;
  takenAt: string;
}

const MIN_PHOTOS = 2;
const MIN_REASON = 4;

export function VisitReportForm(props: VisitReportFormProps) {
  const router = useRouter();
  const [visitedAt, setVisitedAt] = useState(props.today);
  const [premisesFound, setPremisesFound] = useState(false);
  const [signageMatches, setSignageMatches] = useState(false);
  const [stockPresent, setStockPresent] = useState(false);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [photos, setPhotos] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready =
    photos.length >= MIN_PHOTOS &&
    visitedAt !== "" &&
    reason.trim().length >= MIN_REASON &&
    !uploading &&
    !pending;

  /** One reading per photograph, so two photographs from two corners differ. */
  async function here(): Promise<{ lat: number; lng: number }> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error(t("admin.visit.no_geolocation")));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => reject(new Error(t("admin.visit.no_geolocation"))),
        { enableHighAccuracy: true, timeout: 15_000 },
      );
    });
  }

  async function add(files: FileList) {
    setError(null);
    setUploading(true);
    try {
      for (const file of [...files]) {
        // Position first. A photograph uploaded and then found to have no
        // coordinates is an orphan object nobody will go and delete.
        const at = await here();

        const signForm = new FormData();
        signForm.set("businessId", props.businessId);
        signForm.set("filename", file.name);
        signForm.set("type", file.type);
        signForm.set("bytes", String(file.size));

        const signed = await props.signPhoto(signForm);
        if (!signed.ok) {
          setError(signed.error);
          return;
        }

        const response = await fetch(signed.url, {
          method: "PUT",
          headers: { "content-type": file.type },
          body: file,
        });
        if (!response.ok) {
          setError(t("media.storage_off"));
          return;
        }

        const recordForm = new FormData();
        recordForm.set("businessId", props.businessId);
        recordForm.set("path", signed.path);
        recordForm.set("bytes", String(file.size));
        const recorded = await props.recordPhoto(recordForm);
        if (!recorded.ok) {
          setError(recorded.error);
          return;
        }

        setPhotos((current) => [
          ...current,
          {
            mediaId: recorded.mediaId,
            filename: file.name,
            lat: at.lat,
            lng: at.lng,
            // The file's own timestamp where it has one, which is closer to
            // when the photograph was taken than when it was uploaded.
            takenAt: new Date(file.lastModified || Date.now()).toISOString(),
          },
        ]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("admin.visit.no_geolocation"));
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    const form = new FormData();
    form.set("businessId", props.businessId);
    if (props.requestId) form.set("requestId", props.requestId);
    form.set("visitedAt", visitedAt);
    if (premisesFound) form.set("premisesFound", "on");
    if (signageMatches) form.set("signageMatches", "on");
    if (stockPresent) form.set("stockPresent", "on");
    form.set("notes", notes);
    form.set("reason", reason);
    form.set("photos", JSON.stringify(photos));

    startTransition(async () => {
      const outcome = await props.fileReport(form);
      setResult(outcome);
      if (outcome.ok) router.push("/admin/visits");
    });
  }

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      <Panel title={t("admin.visit.what_you_found")}>
        <div className="flex flex-col gap-4">
          <div className="max-w-xs">
            <Label htmlFor="visited-at" requirement="required">
              {t("admin.visit.visited_at")}
            </Label>
            <Input
              id="visited-at"
              type="date"
              value={visitedAt}
              onChange={(event) => setVisitedAt(event.target.value)}
            />
          </div>

          {/*
             Three separate answers rather than one "passed" tick. A visit where
             the premises exist and the stock does not is a different fact from
             one where nothing was there, and a tier decision rests on which.
          */}
          <Checkbox
            checked={premisesFound}
            onChange={(event) => setPremisesFound(event.target.checked)}
            label={t("admin.visit.premises_found")}
          />
          <Checkbox
            checked={signageMatches}
            onChange={(event) => setSignageMatches(event.target.checked)}
            label={t("admin.visit.signage_matches")}
          />
          <Checkbox
            checked={stockPresent}
            onChange={(event) => setStockPresent(event.target.checked)}
            label={t("admin.visit.stock_present")}
          />

          <div>
            <Label htmlFor="visit-notes">{t("admin.visit.notes")}</Label>
            <Textarea
              id="visit-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
      </Panel>

      <Panel title={t("admin.visit.photos")}>
        <div className="flex flex-col gap-4">
          <p className="max-w-prose text-caption text-muted">{t("admin.visit.photos_hint")}</p>

          <FileDrop
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            idleLabel={t("admin.visit.photos_drop")}
            idleHint={t("admin.visit.photos_drop_hint")}
            state={uploading ? "uploading" : photos.length > 0 ? "done" : "idle"}
            onSelect={(files) => void add(files)}
          />

          {photos.length > 0 && (
            <ul className="flex flex-col gap-2">
              {photos.map((photo) => (
                <li key={photo.mediaId} className="flex flex-wrap items-center gap-2">
                  <span className="text-body-sm text-ink">{photo.filename}</span>
                  {/* The coordinates on screen, because the refusal quotes them. */}
                  <Tag size="sm">
                    {photo.lat.toFixed(3)}, {photo.lng.toFixed(3)}
                  </Tag>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setPhotos((current) => current.filter((p) => p.mediaId !== photo.mediaId))
                    }
                  >
                    {t("admin.visit.photo_remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {photos.length < MIN_PHOTOS && (
            <p className="text-caption text-muted">
              {t("admin.visit.photos_short", { count: String(MIN_PHOTOS - photos.length) })}
            </p>
          )}

          {error && (
            <Alert tone="bad" live="assertive">
              {error}
            </Alert>
          )}
        </div>
      </Panel>

      <Panel title={t("admin.review.reason_label")}>
        <div className="flex flex-col gap-3">
          {/*
             Labelled, not just sat under a panel heading. A panel title is not
             an accessible name for the field inside it, so without this the
             input is announced as an unnamed textbox.
          */}
          <div>
            <Label htmlFor="visit-reason" requirement="required">
              {t("admin.review.reason_label")}
            </Label>
            <Input
              id="visit-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <p className="text-caption text-muted">{t("admin.visit.reason_hint")}</p>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!ready} onClick={submit}>
              {t("admin.visit.file")}
            </Button>
            <Button variant="ghost" onClick={() => router.push("/admin/visits")}>
              {t("action.cancel")}
            </Button>
          </div>

          {result && !result.ok && (
            <Alert tone="bad" live="assertive" fix={t("admin.review.reason_hint")}>
              {result.error}
            </Alert>
          )}
        </div>
      </Panel>
    </div>
  );
}
