import { Card } from "@/components/structure";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";
import {
  ContactActions,
  ContactReveal,
  RevealNote,
} from "@/app/(public)/b/[slug]/ContactReveal";
import { MaskedNumber } from "@/components/storefront/MaskedNumber";
import { ContactLeadTable } from "@/app/(dashboard)/dashboard/leads/phone/_table";
import { Section, States } from "../_kit";
import { LeadGateSpecimen } from "./ContactRevealSpecimens";
import {
  BRANCH_ID,
  BRANCH_MASKED,
  GALLERY_BUSINESS_ID,
  GALLERY_NOTE,
  GALLERY_SUPPLIER,
  MASKED,
  REVEALED,
  SELLER_PAGE,
  STAFF_PAGE,
  WHATSAPP_HREF,
} from "./contact-reveal-fixture";

/**
 * Board `1d` amendment — the contact reveal, in place, in every state its spec
 * names, and the two lead tables it feeds.
 *
 * The identity row is the real island. The form is drawn in a frame rather than
 * opened as a modal; on the storefront it is a `<dialog>` in the viewport.
 */
function Identity({
  masked,
  revealed = false,
  whatsapp = true,
  own = false,
}: {
  masked: string | null;
  revealed?: boolean;
  whatsapp?: boolean;
  /** A seat on the listing's own team: no composer trigger (`app/(public)/b/[slug]/_own.tsx`). */
  own?: boolean;
}) {
  return (
    <ContactReveal
      businessId={GALLERY_BUSINESS_ID}
      supplierName={GALLERY_SUPPLIER}
      formRequired
      prefill={null}
      initial={revealed ? REVEALED : null}
      note={GALLERY_NOTE}
      privacyHref="#contact-reveal"
    >
      <div className="w-full rounded-card border border-line bg-card px-5 pb-5 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-serif text-h1-serif text-brand">{GALLERY_SUPPLIER}</p>
            <p className="mt-1 text-body-sm text-muted">Industrial &amp; MEP supplies · Jebel Ali Free Zone, Dubai</p>
          </div>
          <ContactActions
            layout="row"
            masked={masked}
            whatsAppHref={whatsapp ? WHATSAPP_HREF : null}
            enquire={own ? null : <Button size="md">{t("storefront.request_quote")}</Button>}
          />
        </div>
        <RevealNote />
      </div>
    </ContactReveal>
  );
}

export function ContactRevealGallery() {
  return (
    <Section id="contact-reveal" title="Contact reveal" note="board 1d amendment · /b/:slug">
      <States label="masked · as shipped" stack>
        <Identity masked={MASKED} />
      </States>
      <States label="form open" stack>
        <LeadGateSpecimen label="Lead form, empty" supplierName={GALLERY_SUPPLIER} />
      </States>
      <States label="form · signed in, prefilled" stack>
        <LeadGateSpecimen
          label="Lead form, prefilled"
          supplierName={GALLERY_SUPPLIER}
          prefill={{ name: "Priya Menon", email: "priya@marina-fm.test", mobile: "50 641 2288" }}
        />
      </States>
      <States label="form · field invalid, on submit" stack>
        <LeadGateSpecimen
          label="Lead form, invalid"
          supplierName={GALLERY_SUPPLIER}
          values={{ name: "P", email: "priya@marina-fm", mobile: "04 883 4120" }}
          problems={{ name: "name_short", email: "email_shape", mobile: "mobile_not_uae" }}
        />
      </States>
      <States label="form · refused, too many" stack>
        <LeadGateSpecimen
          label="Lead form, refused"
          supplierName={GALLERY_SUPPLIER}
          values={{ name: "Priya Menon", email: "priya@marina-fm.test", mobile: "50 641 2288" }}
          failure={t("contact.error.rate_limited", { count: 42 })}
        />
      </States>
      <States label="revealed · note, tel link" stack>
        <Identity masked={MASKED} revealed />
      </States>
      <States label="seller has no landline" stack>
        <Identity masked={null} />
      </States>
      <States label="no landline, no whatsapp" stack>
        <Identity masked={null} whatsapp={false} />
      </States>
      <States label="the listing's own team · no Request a quote — no business enquires to itself" stack>
        <Identity masked={MASKED} own />
      </States>
      <States label="branches tab · masked, revealed">
        <ContactReveal
          businessId={GALLERY_BUSINESS_ID}
          supplierName={GALLERY_SUPPLIER}
          formRequired
          prefill={null}
          initial={null}
          note={GALLERY_NOTE}
          privacyHref="#contact-reveal"
        >
          <Card>
            <MaskedNumber numberKey={BRANCH_ID} masked={BRANCH_MASKED} />
          </Card>
        </ContactReveal>
        <ContactReveal
          businessId={GALLERY_BUSINESS_ID}
          supplierName={GALLERY_SUPPLIER}
          formRequired={false}
          prefill={null}
          initial={REVEALED}
          note={GALLERY_NOTE}
          privacyHref="#contact-reveal"
        >
          <Card>
            <MaskedNumber numberKey={BRANCH_ID} masked={BRANCH_MASKED} />
          </Card>
        </ContactReveal>
      </States>
      <States label="seller · /dashboard/leads/phone" stack>
        <div className="w-full">
          <ContactLeadTable page={SELLER_PAGE} audience="seller" caption={t("phoneleads.caption")} />
        </div>
      </States>
      <States label="seller · no leads yet" stack>
        <Card>
          <h3 className="text-h3 text-ink">{t("phoneleads.empty_title")}</h3>
          <p className="mt-1 text-body-sm text-muted">{t("phoneleads.empty_body")}</p>
        </Card>
      </States>
      <States label="seller · no landline" stack>
        <Card>
          <h3 className="text-h3 text-ink">{t("phoneleads.no_landline_title")}</h3>
          <p className="mt-1 text-body-sm text-muted">{t("phoneleads.no_landline_body")}</p>
        </Card>
      </States>
      <States label="staff · /admin/leads" stack>
        <div className="w-full">
          <ContactLeadTable page={STAFF_PAGE} audience="staff" caption={t("admin.leads.caption")} />
        </div>
      </States>
      <States label="staff · filtered, none" stack>
        <p className="rounded-card border border-line bg-card px-4 py-6 text-body-sm text-muted">
          {t("admin.leads.empty_filtered", { supplier: "Coastline" })}
        </p>
      </States>
    </Section>
  );
}
