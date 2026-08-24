import { cn } from "@/lib/cn";
import { Button } from "@/components/primitives";
import { Card } from "@/components/structure";
import { ImagePlaceholder, StatusBadge, type StatusTone } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CompletenessMeter } from "./CompletenessMeter";

/**
 * One product. Availability leads, and there is no price.
 *
 * `Product` has no price column and no public surface may render one, so where
 * a price would sit on any other catalogue there is availability and an
 * enquiry action. That is the whole commercial model on one card: the buyer
 * asks, the seller quotes privately, and the platform never sees the number.
 *
 * The action changes with availability. `out_of_stock` becomes "Notify me",
 * because "Send enquiry" on something nobody can supply wastes both sides'
 * time. Every action is disabled this handoff — the enquiry engine is next.
 */
export type Availability = "in_stock" | "made_to_order" | "indent" | "out_of_stock";

export interface ProductCardProduct {
  slug: string;
  businessSlug: string;
  name: string;
  sku?: string | null;
  availability: Availability;
  stockQty?: number | null;
  leadTimeDays?: number | null;
  minOrderQty?: number | null;
  imageUrl?: string | null;
  /** From the category's spec template. */
  specFilled?: number;
  specTotal?: number;
  /** Already formatted by formatSize, e.g. "DN100 · 4 inch". */
  sizeLabel?: string;
}

export interface ProductCardProps {
  product: ProductCardProduct;
  /** Grid tile, or a compact row inside a catalogue list. */
  layout?: "grid" | "row";
  href?: string;
}

const AVAILABILITY_TONE: Record<Availability, StatusTone> = {
  in_stock: "ok",
  made_to_order: "info",
  indent: "warn",
  out_of_stock: "neutral",
};

const AVAILABILITY_KEY = {
  in_stock: "availability.in_stock",
  made_to_order: "availability.made_to_order",
  indent: "availability.indent",
  out_of_stock: "availability.out_of_stock",
} as const;

export function ProductCard({ product, layout = "grid", href }: ProductCardProps) {
  const link = href ?? `/b/${product.businessSlug}/p/${product.slug}`;
  const outOfStock = product.availability === "out_of_stock";

  const media =
    product.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={product.imageUrl}
        alt={product.name}
        className={cn(
          "border border-line bg-card object-cover",
          layout === "grid" ? "aspect-[4/3] w-full rounded-t-card" : "size-16 shrink-0 rounded-chip",
        )}
      />
    ) : (
      <div className={cn(layout === "grid" ? "w-full" : "w-16 shrink-0")}>
        <ImagePlaceholder
          kind="empty"
          ratio={layout === "grid" ? "4 / 3" : "1 / 1"}
          rounded={layout === "grid" ? "card" : "chip"}
          label={layout === "grid" ? t("display.no_image") : undefined}
        />
      </div>
    );

  const body = (
    <div className={cn("min-w-0 flex-1", layout === "grid" ? "p-3" : "py-0.5")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-body-sm text-ink">
          <a
            href={link}
            className={cn(
              "rounded-tag underline-offset-2 hover:underline",
              "focus-visible:outline-none focus-visible:shadow-focus",
            )}
          >
            {product.name}
          </a>
        </h3>
        <StatusBadge size="sm" dot tone={AVAILABILITY_TONE[product.availability]}>
          {t(AVAILABILITY_KEY[product.availability])}
        </StatusBadge>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {product.sku && (
          <span className="font-mono text-eyebrow text-muted">{product.sku}</span>
        )}
        {product.sizeLabel && (
          <span className="font-mono text-eyebrow text-muted">{product.sizeLabel}</span>
        )}
        {product.availability === "in_stock" && product.stockQty != null && (
          <span className="font-mono text-eyebrow tabular-nums text-muted">
            {t("product.in_stock_qty", { qty: formatCount(product.stockQty) })}
          </span>
        )}
        {product.leadTimeDays != null && (
          <span className="font-mono text-eyebrow tabular-nums text-muted">
            {t("product.lead_time", { days: product.leadTimeDays })}
          </span>
        )}
        {product.minOrderQty != null && (
          <span className="font-mono text-eyebrow tabular-nums text-muted">
            {t("product.min_order", { qty: formatCount(product.minOrderQty) })}
          </span>
        )}
      </div>

      {product.specTotal !== undefined && product.specFilled !== undefined && (
        <div className="mt-2">
          <CompletenessMeter
            bare
            label={t("display.spec_completeness")}
            filled={product.specFilled}
            total={product.specTotal}
            valueLabel={t("display.fields_filled", {
              filled: product.specFilled,
              total: product.specTotal,
            })}
          />
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        {/*
          Where a price would go on any other catalogue. Product has no price
          column, and no public surface may render one — this is the line that
          says so out loud rather than leaving a gap the eye reads as missing.
        */}
        <span className="text-caption text-muted">{t("product.no_price")}</span>
        <Button size="sm" variant={outOfStock ? "secondary" : "primary"} disabled title={t("enquiry.disabled")}>
          {outOfStock ? t("product.notify") : t("product.enquire")}
        </Button>
      </div>
    </div>
  );

  if (layout === "row") {
    return (
      <Card as="article" interactive padded={false}>
        <div className="flex gap-3 p-3">
          {media}
          {body}
        </div>
      </Card>
    );
  }

  return (
    <Card as="article" interactive padded={false}>
      {media}
      {body}
    </Card>
  );
}
