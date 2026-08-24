/**
 * Where a payment would happen, if there were one yet.
 *
 * There is no gateway in this stack and the decision was deliberate: proration,
 * entitlements and invoicing are ours and fully testable, and a real provider
 * drops in behind this interface without touching a screen. The same shape
 * `lib/notify/senders/` uses for WhatsApp, and the OTP delivery for SMS.
 *
 * What is deliberately **not** here: anything that moves a buyer's money.
 * CLAUDE.md is explicit — the platform is never party to a transaction, holds
 * no funds and refunds none. This port charges one seller for one subscription
 * and nothing else. A method that took a buyer payment would be the first step
 * of turning a directory into a marketplace.
 */

export interface ChargeRequest {
  businessId: string;
  /** Whole fils. Negative is a credit and must not reach a provider as a charge. */
  fils: number;
  /** What the seller will see on their statement. */
  description: string;
  /** Our own reference, so a provider's record can be matched back to an invoice. */
  reference: string;
}

export interface ChargeResult {
  ok: boolean;
  /** Whatever the provider calls this transaction. Stored on the invoice. */
  providerRef?: string;
  /** Present when `ok` is false. Shown to the seller, so it says what to do. */
  error?: string;
}

export interface PaymentProvider {
  readonly name: string;
  /**
   * True when this provider can actually take money. The console one cannot,
   * and screens ask so they can say so rather than implying a card was charged.
   */
  readonly live: boolean;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  /** Stop future charges. Does not refund; there is nothing here that refunds. */
  cancel(providerRef: string): Promise<{ ok: boolean; error?: string }>;
}

/**
 * The development provider. Records the intent and takes nothing.
 *
 * `live: false` is load-bearing: the billing screens read it and say "no card
 * has been charged" rather than showing a receipt for a payment that did not
 * happen. A stub that pretends to succeed silently is how a staging
 * environment convinces somebody the billing works.
 */
export const consoleProvider: PaymentProvider = {
  name: "console",
  live: false,

  async charge(request) {
    if (request.fils < 0) {
      return { ok: false, error: "A credit is not a charge. Apply it to the next invoice." };
    }
    console.info("[billing] would charge", {
      businessId: request.businessId,
      aed: (request.fils / 100).toFixed(2),
      description: request.description,
      reference: request.reference,
    });
    return { ok: true, providerRef: `console_${request.reference}` };
  },

  async cancel(providerRef) {
    console.info("[billing] would stop future charges", { providerRef });
    return { ok: true };
  },
};

let current: PaymentProvider = consoleProvider;

/** Swapped once, at startup, when a real provider exists. */
export function setPaymentProvider(provider: PaymentProvider): void {
  current = provider;
}

export function paymentProvider(): PaymentProvider {
  return current;
}
