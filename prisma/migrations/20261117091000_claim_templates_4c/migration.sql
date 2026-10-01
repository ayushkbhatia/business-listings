-- Board `4c` `B3` — the templates for the five claim messages, in production.
--
-- Templates are database rows and the seed refuses a non-loopback database, so
-- a template added to `prisma/seed-notification-templates.mts` and not written
-- here would exist locally and in CI and nowhere a claimant could receive it.
-- `tests/unit/notification-templates.test.ts` reads this file and holds it equal
-- to the catalogue.
--
-- Neutral, email and in-app: a claim is about a licence rather than a trade,
-- and a claimant holds no seat whose channels a seller's matrix would read.
-- No body names, describes or carries the contact details of another claimant
-- (`2a` AC5) — the listing's name and the claimant's own claim, nothing else.
--
-- Written only where the line — event, channel and kind — has no row of any
-- version, so copy somebody has since edited on `/admin/notifications` stays as
-- they left it and a second run is a no-op.
--
-- ## Ordering
--
-- **Additive, and applies last, seconds before the merge** — after
-- `20261117090000_claim_conflict_enums_4c`, whose enum values it casts to. A
-- deployed client that meets a row carrying an event value it does not know
-- refuses the whole read, so these rows wait until the code that sends them is
-- about to ship.

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
  ('claim_conflict_opened', 'email', 'neutral', 'live', 'Your claim on {businessName} is being reviewed with another',
   'Another claim on {businessName} reached us, so a person now decides between them. You will hear the outcome within {hours} hours. We may ask you for one more document; nothing else is needed from you now.',
   'See your claim', '/onboarding/verify?business={businessId}', NULL),
  ('claim_conflict_opened', 'in_app', 'neutral', 'live', NULL,
   'Another claim on {businessName} reached us. A person decides between them within {hours} hours.',
   'See your claim', '/onboarding/verify?business={businessId}', NULL),
  ('claim_awarded', 'email', 'neutral', 'live', 'Your claim on {businessName} was approved',
   '{businessName} is yours to manage. Its reviews, enquiries and search history stay with it, and checking the licence for the green badge is the next step.',
   'Open your dashboard', '/dashboard', NULL),
  ('claim_awarded', 'in_app', 'neutral', 'live', NULL,
   'Your claim on {businessName} was approved. The listing is yours to manage.',
   'Open your dashboard', '/dashboard', NULL),
  ('claim_not_awarded', 'email', 'neutral', 'live', 'Your claim on {businessName} was not approved',
   'We looked at every claim on {businessName}, and yours was not approved. {reason} If you think we got this wrong, raise a dispute with your trade licence and a person will look again.',
   'Raise a dispute', '/onboarding/verify?business={businessId}&dispute=1', NULL),
  ('claim_not_awarded', 'in_app', 'neutral', 'live', NULL,
   'Your claim on {businessName} was not approved. {reason}',
   'Raise a dispute', '/onboarding/verify?business={businessId}&dispute=1', NULL),
  ('claim_documents_requested', 'email', 'neutral', 'live', 'One more document for your claim on {businessName}',
   'To decide the claims on {businessName}, we ask every claimant for the registered tenancy contract for their unit — Tawtheeq in Abu Dhabi. Upload yours to your claim. The decision does not wait for it.',
   'Upload it', '/onboarding/verify?business={businessId}', NULL),
  ('claim_documents_requested', 'in_app', 'neutral', 'live', NULL,
   'Upload the registered tenancy contract for your unit to your claim on {businessName}.',
   'Upload it', '/onboarding/verify?business={businessId}', NULL),
  ('claim_new_listing_created', 'email', 'neutral', 'live', '{newBusinessName} has a listing of its own',
   'Your claim on {businessName} was settled with a listing of its own for your licence: {newBusinessName}. It starts unpublished. Finish setting it up to put it in front of buyers.',
   'Set it up', '/dashboard', NULL),
  ('claim_new_listing_created', 'in_app', 'neutral', 'live', NULL,
   '{newBusinessName} now has a listing of its own, built from your licence. Finish setting it up to publish it.',
   'Set it up', '/dashboard', NULL)
) AS v(event, channel, kind, status, subject, body, action_label, action_path, meta_template_name)
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_template" t
   WHERE t."event" = v.event::"notification_event"
     AND t."channel" = v.channel::"notification_channel"
     AND t."kind" = v.kind::"template_kind"
     AND t."locale" = 'en'
);
