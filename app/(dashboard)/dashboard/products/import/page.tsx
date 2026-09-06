import { getSpecFieldOptions } from "@/lib/db/queries/catalogue";
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
    prisma.product.count({ where: { businessId: seat.businessId } }),
  ]);

  const room = caps ? allowance(caps, "products", used) : null;

  const specFields = await getSpecFieldOptions(business.primaryCategoryId);

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
        room={room?.remaining ?? null}
        roomLabel={roomLabel(room, caps?.name ?? "")}
        specFields={specFields.map((f) => ({
          id: f.id,
          label: f.label,
          isFilterable: f.isFilterable,
        }))}
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
