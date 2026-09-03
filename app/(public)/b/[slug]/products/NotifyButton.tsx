"use client";

import { useState } from "react";
import { Button, Input } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { WatchActionResult } from "./actions";

/**
 * "Notify me", and the smallest thing that can keep the promise.
 *
 * A signed-in buyer needs one press. Everyone else needs somewhere to be told,
 * so the number is asked for only after they have shown they want it — putting
 * a phone field on every out-of-stock card would be asking twenty times for
 * something nobody has agreed to yet.
 *
 * The confirmation replaces the control rather than sitting beside it. A button
 * that still says "Notify me" after you pressed it invites a second press, and
 * the watch is idempotent precisely because people do that.
 */
export function NotifyButton({
  productId,
  productName,
  signedIn,
  watch,
}: {
  productId: string;
  /** Names the product in the accessible label — criterion 14. */
  productName: string;
  signedIn: boolean;
  watch: (formData: FormData) => Promise<WatchActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState("");
  const [result, setResult] = useState<WatchActionResult | null>(null);
  const [pending, setPending] = useState(false);

  function send() {
    const form = new FormData();
    form.set("productId", productId);
    form.set("contact", contact);

    void (async () => {
      setPending(true);
      try {
        setResult(await watch(form));
      } finally {
        setPending(false);
      }
    })();
  }

  if (result?.ok) {
    return (
      <p className="text-caption text-ok" role="status">
        {result.message}
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="secondary"
        block
        loading={pending}
        aria-label={t("product.notify_about", { product: productName })}
        onClick={() => (signedIn ? send() : setOpen(true))}
      >
        {t("product.notify")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        name="contact"
        type="tel"
        value={contact}
        onChange={(event) => setContact(event.target.value)}
        aria-label={t("alert.contact")}
        placeholder="050 123 4567"
      />
      {result && !result.ok && (
        <p className="text-caption text-danger" role="alert">
          {result.error}
        </p>
      )}
      <Button size="sm" variant="secondary" block loading={pending} onClick={send}>
        {t("product.notify_confirm")}
      </Button>
    </div>
  );
}
