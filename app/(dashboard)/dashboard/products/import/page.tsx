import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance } from "@/lib/plan/entitlements";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { previewImportFile, runImport, undoImport } from "../actions";
import { ImportWizard } from "./ImportWizard";

/**
 * Board 11d — the CSV import mapper.
 *
 * The category is the business's primary one. A seller importing into a second
 * category picks it on the catalogue screen first; offering a category chooser
 * here would make the spec fields change under a mapping already in progress.
 */
export const metadata = { title: t("import.title") };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const seat = await requireSellerSeat();
  const [business, badges, caps, used] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: { primaryCategoryId: true },
    }),
    getNavBadges(seat.businessId),
    /*
       The same allowance `applyImport` refuses on, read here so the screen can
       say it before a file is chosen rather than after every column is mapped.
       Two readers of one function, not two definitions of the cap.
    */
    effectiveFor(seat.businessId),
    /*
       Live, not every record. The cap is on reach — `3f`'s header counts the
       same way, and this screen counted every draft as though it took a listing
       slot, which reads as no room over a catalogue with plenty.
    */
    prisma.product.count({ where: { businessId: seat.businessId, status: "live" } }),
  ]);

  const room = caps ? allowance(caps, "products", used) : null;

  /*
     CSV import is a plan entitlement, and it is enforced here.

     Board 11f renders `CSV import` as a row in the comparison grid, which makes
     it config — and an entitlement a screen advertises and does not enforce is
     the unenforced limit the spec warns about. Free does not carry it. A `404`
     rather than a locked panel: `8c` links here from the setup flow and a Free
     seller who follows that link should find the importer absent, not dimmed
     with an upsell where a file picker was.
  */
  if (caps && !caps.csvImport) notFound();

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/products"
      eyebrow={t("import.eyebrow")}
      title={t("import.title")}
    >
      <ImportWizard
        categoryId={business.primaryCategoryId}
        roomLabel={roomLabel(room, caps?.name ?? "")}
        previewAction={previewImportFile}
        runAction={runImport}
        undoAction={undoImport}
      />
    </SellerPage>
  );
}

/**
 * What the upload step says about the plan, in one sentence.
 *
 * Three states rather than one with a number in it: room, no room, and no cap.
 * "Room for 0 more products" is a sentence that reads like an answer and is
 * really a refusal, so the empty case says what to do about it instead.
 */
function roomLabel(
  room: { remaining: number | null; cap: number | null } | null,
  plan: string,
): string {
  if (!room || room.cap === null) return t("import.room_unlimited", { plan });
  if (room.remaining === 0) return t("import.room_none", { cap: String(room.cap), plan });
  return t("import.room", {
    count: room.remaining ?? 0,
    formatted: formatCount(room.remaining ?? 0),
    plan,
  });
}
