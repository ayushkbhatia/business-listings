import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { AlertsForm, type AlertsValue } from "./AlertsForm";

/**
 * Board 7e — alerts.
 *
 * The rest of settings is handoff 3. This is the notification matrix, which
 * this handoff needs and which nothing else can stand in for: quiet hours and
 * the high-value override are the seller's own decisions, and the send layer
 * reads them on every event.
 */
export const metadata = { title: "Alerts" };
export const dynamic = "force-dynamic";

const DEFAULTS: AlertsValue = {
  routing: {
    enquiry_received: ["whatsapp", "in_app"],
    enquiry_unanswered: ["whatsapp", "in_app"],
    enquiry_escalated: ["whatsapp", "email", "in_app"],
    quote_accepted: ["whatsapp", "email", "in_app"],
    quote_expiring: ["in_app"],
    review_posted: ["email", "in_app"],
    document_expiring: ["email", "in_app"],
    weekly_digest: ["email"],
  },
  quietHoursEnabled: true,
  quietFromHour: 21,
  quietToHour: 7,
  quietOnSunday: true,
  highValueOverrideAed: 50_000,
  escalateAfterMinutes: 120,
  nudgeEnabled: true,
  nudgeAfterHours: 24,
};

export default async function AlertsPage() {
  const seat = await requireSellerSeat();

  const [preference, badges, pendingWhatsApp] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { businessId: seat.businessId } }),
    getNavBadges(seat.businessId),
    // Said out loud rather than left to look broken: a seller who switches
    // WhatsApp on and hears nothing deserves to know why.
    prisma.notificationTemplate.count({ where: { channel: "whatsapp", status: "pending_meta" } }),
  ]);

  const value: AlertsValue = preference
    ? {
        routing: (preference.routing ?? {}) as Record<string, string[]>,
        quietHoursEnabled: preference.quietHoursEnabled,
        quietFromHour: preference.quietFromHour,
        quietToHour: preference.quietToHour,
        quietOnSunday: preference.quietOnSunday,
        highValueOverrideAed: preference.highValueOverrideAed,
        escalateAfterMinutes: preference.escalateAfterMinutes,
        nudgeEnabled: preference.nudgeEnabled,
        nudgeAfterHours: preference.nudgeAfterHours,
      }
    : DEFAULTS;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/settings"
      title={t("alerts.title")}
      meta={<span className="text-caption text-muted">{t("alerts.lede")}</span>}
    >
      <AlertsForm value={value} whatsappPending={pendingWhatsApp > 0} />
    </SellerPage>
  );
}
