"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Checkbox } from "@/components/primitives";
import { SelectionBar } from "@/components/structure";
import { ProductCard, type ProductCardProduct, type RecipientPreview } from "@/components/domain";
import { t } from "@/lib/i18n";
import { EnquireDrawer } from "../EnquireDrawer";
import {
  selectionKey,
  selectionServerSnapshot,
  selectionSnapshot,
  setSelection,
  subscribeSelection,
} from "./selection-store";

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
 *
 * ## Why it is in sessionStorage
 *
 * Criterion 12: the selection survives filter and sort changes, and clears when
 * the buyer leaves the storefront. Every filter in this rail is an anchor, so a
 * filter change is a page load — React state would be discarded by exactly the
 * interaction the criterion is about.
 *
 * Keyed by seller, so it is scoped the way the board requires: navigating to
 * another storefront reads a different key and finds nothing. The clearing is
 * silent because nothing of value is lost, and `sessionStorage` means closing
 * the tab ends it. This is not a basket — there is no cart, nothing crosses
 * sellers, and nothing survives the session.
 */
export interface TrayProduct extends ProductCardProduct {
  id: string;
  /** The nominal size as stored, for the composer's size column. */
  size: string | null;
  /**
   * The watch control for this line, already rendered by the server page.
   *
   * A node rather than a function: a function cannot cross the server-to-client
   * boundary, and the first version of this passed one and rendered nothing at
   * all. Elements serialise, which is why `ContactCard` takes its composer
   * trigger the same way.
   */
  notify?: React.ReactNode;
  /** The inline spec table, likewise pre-rendered. */
  specs?: React.ReactNode;
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
  const [composing, setComposing] = useState(false);

  const storageKey = selectionKey(businessSlug);
  const subscribe = useMemo(() => subscribeSelection(storageKey), [storageKey]);
  const selected = useSyncExternalStore(
    subscribe,
    () => selectionSnapshot(storageKey),
    selectionServerSnapshot,
  );

  const setSelected = useCallback(
    (next: readonly string[]) => setSelection(storageKey, next),
    [storageKey],
  );

  /*
     Selected products this page happens to be showing.

     A selection made before a filter change can name products that are no
     longer on screen, and they stay selected — criterion 12 — but the composer
     can only carry lines it has names for. The count on the bar is the honest
     one: what it will actually send.
  */
  const chosen = products.filter((p) => selected.includes(p.id));

  return (
    <>
      {/*
         Board 1e's grid: four columns at the widest, three at 1024, two on a
         tablet, one below. The compact single-column card is `ProductCard`'s
         own row layout rather than a second component.
      */}
      <ul className="mt-3 grid list-none gap-[var(--gutter)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {products.map((product) => (
          <li key={product.id} className="relative">
            <ProductCard
              product={product}
              {...(product.notify ? { notifyAction: product.notify } : {})}
              {...(product.specs ? { specs: product.specs } : {})}
            />
            <div className="mt-1.5">
              <Checkbox
                checked={selected.includes(product.id)}
                label={t("tray.select", { name: product.name })}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, product.id]
                      : selected.filter((id) => id !== product.id),
                  )
                }
              />
            </div>
          </li>
        ))}
      </ul>

      {chosen.length > 0 ? (
        /*
           Sticky at every width, and stuck to the viewport bottom below 1024.

           Board 1e is explicit that this matters more on a phone, not less:
           typing a long requirement on a phone is worse than tapping four
           checkboxes, so the accelerator is most valuable exactly where the
           screen is smallest.
        */
        <div className="sticky bottom-0 z-20 -mx-5 mt-4 border-t border-line bg-card px-5 py-2 lg:mx-0 lg:bottom-4 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
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
          productId: p.id,
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
