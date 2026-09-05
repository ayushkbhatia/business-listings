-- The deep link follows the composer.
--
-- Board 3j moves the quote composer off `/dashboard/leads/:id/thread` and onto
-- the lead itself, which is the two-composer model §2 locks: an RFQ is priced on
-- the inbox, an ENQ is answered in the thread.
--
-- `NotificationTemplate.actionPath` is a stored column, so the seeded rows are
-- not the only ones — a template edited through the admin console carries its
-- own copy. Every seller-facing lead notification says "Open and quote", "Quote
-- now" or "Open the accepted quote", and all three now mean the composer or the
-- released contact details, both of which are on the lead.
--
-- Scoped to the four seller events by name rather than by a `LIKE` over every
-- template: the buyer's own links point into `/enquiry/...` and must not move,
-- and a blanket rewrite is how one of them would.
UPDATE "notification_template"
SET "action_path" = '/dashboard/leads/{enquiryId}'
WHERE "action_path" = '/dashboard/leads/{enquiryId}/thread'
  AND "event" IN ('enquiry_received', 'enquiry_unanswered', 'enquiry_escalated', 'quote_accepted');
