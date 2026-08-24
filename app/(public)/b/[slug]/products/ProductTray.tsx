"use client";

import { useState } from "react";
import { Checkbox } from "@/components/primitives";
import { SelectionBar } from "@/components/structure";
import { ProductCard, type ProductCardProduct, type RecipientPreview } from "@/components/domain";
import { t } from "@/lib/i18n";
import { EnquireDrawer } from "../EnquireDrawer";

/**
 * Board 1e — pick several products, then enquire about all of them at once.
 *
 * A buyer standing in a catalogue is not writing a requirement from scratch;
 * they are pointing at three things on a shelf. Selecting them and carrying
 * them into the composer as lines is the difference between an enquiry that
 * takes ten seconds and one that does not get sent.
 *
 * Selection is client state and deliberately not a URL parameter: it is a
 * scratchpad, not a place, and a back button that restores a half-made
 * selection is more confusing than one that does not.
 */
export interface TrayProduct extends ProductCardProduct {
  id: string;
  /** The nominal size as stored, for the composer's size column. */
  size: string | null;
}

export function ProductTray({
  products,
  businessId,
  businessSlug,
  displayName,
  categoryId,
  emirates,
  recipient,
  signedIn,
}: {
  products: readonly TrayProduct[];
  businessId: string;
  businessSlug: string;
  displayName: string;
  categoryId: string;
  emirates: readonly { value: string; label: string }[];
  recipient: RecipientPreview;
  signedIn: boolean;
}) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [composing, setComposing] = useState(false);

  const chosen = products.filter((p) => selected.includes(p.id));

  return (
    <>
      <div className="mt-3 grid gap-[var(--gutter)] sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <div key={product.id} className="relative">
            <ProductCard product={product} />
            <div className="mt-1.5">
              <Checkbox
                checked={selected.includes(product.id)}
                label={t("tray.select", { name: product.name })}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked ? [...prev, product.id] : prev.filter((id) => id !== product.id),
                  )
                }
              />
            </div>
          </div>
        ))}
      </div>

      {chosen.length > 0 ? (
        <div className="sticky bottom-4 mt-4 z-10">
          <SelectionBar
            count={chosen.length}
            countLabel={(count) => t("tray.selected", { count })}
            onClear={() => setSelected([])}
            clearLabel={t("tray.clear")}
            actions={[
              {
                key: "enquire",
                label: t("tray.enquire", { count: chosen.length }),
                onSelect: () => setComposing(true),
              },
            ]}
          />
        </div>
      ) : null}

      <EnquireDrawer
        open={composing}
        onClose={() => setComposing(false)}
        businessId={businessId}
        businessSlug={businessSlug}
        displayName={displayName}
        categoryId={categoryId}
        emirates={emirates}
        recipient={recipient}
        signedIn={signedIn}
        initialLines={chosen.map((p) => ({
          key: p.id,
          description: p.name,
          qty: p.minOrderQty ?? 1,
          unit: "pcs",
          size: p.size ?? "",
          targetUnitPriceAed: "",
        }))}
      />
    </>
  );
}
