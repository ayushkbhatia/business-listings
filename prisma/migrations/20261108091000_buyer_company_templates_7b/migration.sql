-- Board `7b` — the templates for the buying company's three events, in
-- production.
--
-- Templates are database rows and the seed refuses a non-loopback database, so
-- a template added to `prisma/seed-notification-templates.mts` and not written
-- here would exist locally and in CI and nowhere a buyer could receive it.
-- `tests/unit/notification-templates.test.ts` reads this file and holds it
-- equal to the catalogue.
--
-- Email and in-app, all three. An approval is something to act on today but not
-- at two in the morning, and `BUYER_DEFAULT`'s quiet hours hold an evening
-- request until seven. Neutral kind: a company's own process is neither goods
-- nor services.
--
-- Written only where the pair has no row of any version, so copy somebody has
-- since edited on `/admin/notifications` stays as they left it and a second run
-- is a no-op.
--
-- ## Ordering
--
-- **Additive, and applies after `20261108090500_buyer_company_events_7b`**,
-- whose enum values it casts to. Content rather than schema.

INSERT INTO "notification_template" (
  "id", "event", "channel", "locale", "kind", "version", "status",
  "subject", "body", "action_label", "action_path", "meta_template_name",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  v.event::"notification_event",
  v.channel::"notification_channel",
  'en',
  v.kind::"template_kind",
  1,
  v.status::"template_approval",
  v.subject, v.body, v.action_label, v.action_path, v.meta_template_name,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('approval_requested', 'email', 'neutral', 'live', '{requester} asked you to approve {quoteRef}',
   '{requester} wants to accept {quoteRef} from {businessName} for {amount}, on enquiry {ref}. Your company''s rule needs your approval first. Nothing is accepted and the supplier is not told until you approve it.',
   'Review the request', '/account/company/approvals/{approvalId}', NULL),
  ('approval_requested', 'in_app', 'neutral', 'live', NULL,
   '{requester} asked you to approve {quoteRef} from {businessName}, {amount}.',
   'Review the request', '/account/company/approvals/{approvalId}', NULL),
  ('approval_decided', 'email', 'neutral', 'live', 'Your request for {quoteRef}: {outcome}',
   '{approver} decided on your request to accept {quoteRef} from {businessName}, on enquiry {ref}. Outcome: {outcome}. {nextStep}',
   'Open the request', '/account/company/approvals/{approvalId}', NULL),
  ('approval_decided', 'in_app', 'neutral', 'live', NULL,
   '{approver} decided on {quoteRef} from {businessName}. Outcome: {outcome}. {nextStep}',
   'Open the request', '/account/company/approvals/{approvalId}', NULL),
  ('off_platform_flagged', 'email', 'neutral', 'live', 'A supplier asked to be paid outside Business Listings',
   'A message from {businessName} on enquiry {ref} asks for payment outside the platform, or shares bank details before a quote was accepted. Our review team has it. Nothing was blocked: check with the person who sent the enquiry before anyone pays.',
   'Open your company account', '/account/company', NULL),
  ('off_platform_flagged', 'in_app', 'neutral', 'live', NULL,
   '{businessName} asked to be paid outside the platform on enquiry {ref}. Our review team has it.',
   'Open your company account', '/account/company', NULL)
) AS v(event, channel, kind, status, subject, body, action_label, action_path, meta_template_name)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_template" t
   WHERE t."event" = v.event::"notification_event"
     AND t."channel" = v.channel::"notification_channel"
     AND t."locale" = 'en'
);
