import Link from "next/link";
import { Alert } from "@/components/display";
import { formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { BranchTakenDown, DocumentRequest } from "@/lib/moderation/seller";

/**
 * Board 4b, where the seller reads it.
 *
 * A document our team asked for, and a branch our team took down, each with
 * the reviewer's own words and the one place to act on it. Rendered on the
 * screen the seller goes to act — listing and verification for documents,
 * locations for branches — and nowhere at all when there is nothing to say.
 */

export function DocumentRequests({ requests, uploadHref }: { requests: readonly DocumentRequest[]; uploadHref: string | null }) {
  if (requests.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {requests.map((request) => (
        <Alert
          key={`${request.subject}:${request.subjectId}`}
          tone="warn"
          title={
            request.subject === "credential"
              ? t("moderation.request.credential", { name: request.credentialName ?? "", when: formatRelative(request.requestedAt) })
              : t("moderation.request.change", {
                  field: t(`moderation.field.${request.field ?? "trade_name"}`),
                  when: formatRelative(request.requestedAt),
                })
          }
          {...(uploadHref
            ? {
                action: (
                  <Link href={uploadHref} className="text-body-sm text-moss underline underline-offset-2">
                    {t("moderation.request.upload")}
                  </Link>
                ),
              }
            : { fix: t("moderation.request.fix") })}
        >
          {request.reason}
        </Alert>
      ))}
    </div>
  );
}

export function BranchesTakenDown({ branches }: { branches: readonly BranchTakenDown[] }) {
  if (branches.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {branches.map((branch) => (
        <Alert
          key={branch.locationId}
          tone="bad"
          title={t("moderation.branch_down.title", { area: branch.areaName, when: formatRelative(branch.decidedAt) })}
          fix={t("moderation.branch_down.fix")}
        >
          {branch.reason}
        </Alert>
      ))}
    </div>
  );
}
