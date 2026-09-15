import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "../axe";

const actions = vi.hoisted(() => ({
  revealLandlineAction: vi.fn(),
  submitLandlineLeadAction: vi.fn(),
  recordWhatsAppAction: vi.fn(async () => undefined),
  revealedStateAction: vi.fn(async () => null),
}));
vi.mock("@/app/(public)/b/[slug]/actions", () => actions);

import {
  ContactActions,
  ContactReveal,
  RevealNote,
  type ContactRevealProps,
} from "@/app/(public)/b/[slug]/ContactReveal";
import { MaskedNumber } from "@/components/storefront/MaskedNumber";
import {
  BRANCH_ID,
  BRANCH_MASKED,
  GALLERY_NOTE,
  MASKED,
  REVEALED,
  WHATSAPP_HREF,
} from "@/app/dev/gallery/_sections/contact-reveal-fixture";

/**
 * Board `1d` amendment, as rendered: masked, the form, revealed.
 *
 * The service's rules are proven against a database in
 * `tests/integration/contact-reveal-leads.test.ts`. What is proven here is the
 * island: the number is not in the DOM until the server hands it over, only the
 * landline opens the form, a dismissed form sends nothing, a field problem is
 * said under the field on submit, and the revealed chip is a `tel:` link with
 * the note under it.
 */

beforeAll(() => {
  // jsdom draws <dialog> but does not implement the modal half of it.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

function renderIdentity(overrides: Partial<ContactRevealProps> = {}, masked: string | null = MASKED) {
  return render(
    <main>
      <ContactReveal
        businessId="biz-1"
        supplierName="Al Waha Industrial Supplies"
        formRequired
        prefill={null}
        initial={null}
        note={GALLERY_NOTE}
        privacyHref="/privacy"
        {...overrides}
      >
        <h1>Al Waha Industrial Supplies</h1>
        <ContactActions
          layout="row"
          masked={masked}
          whatsAppHref={WHATSAPP_HREF}
          enquire={<button type="button">Request a quote</button>}
        />
        <RevealNote />
        <MaskedNumber numberKey={BRANCH_ID} masked={BRANCH_MASKED} />
      </ContactReveal>
    </main>,
  );
}

describe("masked (frame 1)", () => {
  it("carries the mask and no number, and WhatsApp is a plain wa.me link", async () => {
    const { container } = renderIdentity();
    expect(screen.getByRole("button", { name: `Show the number ${MASKED}` })).toHaveTextContent(MASKED);
    expect(container.textContent).not.toMatch(/883 4120|8834120|347 2019/);
    expect(container.innerHTML).not.toMatch(/tel:/);
    expect(screen.queryByText(GALLERY_NOTE)).toBeNull();

    const whatsapp = screen.getByRole("link", { name: "WhatsApp" });
    expect(whatsapp).toHaveAttribute("href", WHATSAPP_HREF);
    await userEvent.click(whatsapp);
    // B4: an open is recorded, and never opens the form.
    expect(actions.recordWhatsAppAction).toHaveBeenCalledWith({ businessId: "biz-1", referrer: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has no chip at all where the seller has no landline", () => {
    renderIdentity({}, null);
    // The chip is absent, not masked-and-empty. (The button left is the branch's own number.)
    expect(screen.queryByRole("button", { name: `Show the number ${MASKED}` })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Show the number/ })).toHaveLength(1);
    expect(screen.queryByText(MASKED)).toBeNull();
  });

  it("is axe clean", async () => {
    const { container } = renderIdentity();
    await expectNoAxeViolations(container);
  });
});

describe("the form (frame 2)", () => {
  it("opens on the landline, and a dismissal writes nothing (B11)", async () => {
    renderIdentity();
    await userEvent.click(screen.getByRole("button", { name: `Show the number ${MASKED}` }));
    const dialog = screen.getByRole("dialog", { name: "Access phone number in 30 seconds" });
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Work email")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Mobile")).toBeInTheDocument();
    expect(within(dialog).getByText(/Al Waha Industrial Supplies receives your name, work email and mobile/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.revealLandlineAction).not.toHaveBeenCalled();
    expect(actions.submitLandlineLeadAction).not.toHaveBeenCalled();
  });

  it("says what is wrong under each field on submit, and sends nothing", async () => {
    renderIdentity();
    await userEvent.click(screen.getByRole("button", { name: `Show the number ${MASKED}` }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Mobile"), "04 883 4120");
    await userEvent.click(within(dialog).getByRole("button", { name: "Show the number" }));

    expect(within(dialog).getByText("Enter your name, so the supplier knows who asked.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter your work email, for example name@company.ae.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Enter a UAE mobile starting 05/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveFocus();
    expect(actions.submitLandlineLeadAction).not.toHaveBeenCalled();
  });

  it("opens prefilled for a signed-in buyer, for one confirming tap (B12)", async () => {
    renderIdentity({ prefill: { name: "Priya Menon", email: "priya@marinafm.test", mobile: "50 641 2288" } });
    await userEvent.click(screen.getByRole("button", { name: `Show the number ${MASKED}` }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Priya Menon");
    expect(within(dialog).getByLabelText("Mobile")).toHaveValue("50 641 2288");
  });

  it("is axe clean while open", async () => {
    const { container } = renderIdentity();
    await userEvent.click(screen.getByRole("button", { name: `Show the number ${MASKED}` }));
    await expectNoAxeViolations(container);
  });
});

describe("revealed (frame 3)", () => {
  it("submits, closes, and turns the chip into a tel: link with the note under it", async () => {
    actions.submitLandlineLeadAction.mockResolvedValueOnce({ ok: true, ...REVEALED });
    renderIdentity();
    await userEvent.click(screen.getByRole("button", { name: `Show the number ${MASKED}` }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Priya Menon");
    await userEvent.type(within(dialog).getByLabelText("Work email"), "priya@marinafm.test");
    await userEvent.type(within(dialog).getByLabelText("Mobile"), "50 641 2288");
    await userEvent.click(within(dialog).getByRole("button", { name: "Show the number" }));

    expect(actions.submitLandlineLeadAction).toHaveBeenCalledWith({
      businessId: "biz-1",
      name: "Priya Menon",
      email: "priya@marinafm.test",
      mobile: "50 641 2288",
      referrer: null,
    });
    const call = await screen.findByRole("link", { name: "Call 04 883 4120" });
    expect(call).toHaveAttribute("href", "tel:+97148834120");
    expect(call).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(GALLERY_NOTE)).toBeInTheDocument();
    // One reveal is the listing's: the branch number opens with it.
    expect(screen.getByRole("link", { name: "04 347 2019" })).toHaveAttribute("href", "tel:+97143472019");
  });

  it("reveals without the form for a visitor who already answered it on this listing (B10)", async () => {
    actions.revealLandlineAction.mockResolvedValueOnce({ ok: true, ...REVEALED });
    renderIdentity({ formRequired: false });
    await userEvent.click(screen.getByRole("button", { name: `Show the number ${MASKED}` }));
    expect(await screen.findByRole("link", { name: "Call 04 883 4120" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.submitLandlineLeadAction).not.toHaveBeenCalled();
  });

  it("opens the form, prefilled, where the server says it is still needed", async () => {
    actions.revealLandlineAction.mockResolvedValueOnce({
      ok: false,
      reason: "form_required",
      prefill: { name: "Priya Menon", email: "priya@marinafm.test", mobile: "50 641 2288" },
    });
    renderIdentity({ formRequired: false });
    await userEvent.click(screen.getByRole("button", { name: `Show the number ${MASKED}` }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Work email")).toHaveValue("priya@marinafm.test");
  });

  it("renders revealed for a returning session, and fires nothing (B6)", () => {
    renderIdentity({ initial: REVEALED, formRequired: false });
    expect(screen.getByRole("link", { name: "Call 04 883 4120" })).toBeInTheDocument();
    expect(screen.getByText(GALLERY_NOTE)).toBeInTheDocument();
    expect(actions.revealLandlineAction).not.toHaveBeenCalled();
  });
});
