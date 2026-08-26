-- Handoff 4, step 6d. Board 5e: custom domain verification.
--
-- Criterion 8 asks for four things, and the second decides whether the flow is
-- usable: partial propagation must not read as failure. DNS propagates
-- unevenly, so the two records carry their own states and `partial` is a state
-- of its own rather than an error.

CREATE TYPE "domain_status" AS ENUM ('pending', 'partial', 'verified', 'failed', 'revoked');

CREATE TABLE "custom_domain" (
  "id"              TEXT NOT NULL,
  "business_id"     TEXT NOT NULL,
  "hostname"        TEXT NOT NULL,
  "token"           TEXT NOT NULL,
  "status"          "domain_status" NOT NULL DEFAULT 'pending',
  "cname_state"     TEXT NOT NULL DEFAULT 'waiting',
  "txt_state"       TEXT NOT NULL DEFAULT 'waiting',
  "added_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_checked_at" TIMESTAMP(3),
  "verified_at"     TIMESTAMP(3),
  "certificate_ref" TEXT,
  "failure_cause"   TEXT,

  CONSTRAINT "custom_domain_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "custom_domain"
  ADD CONSTRAINT "custom_domain_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One per business. Two web addresses pointing at one storefront is two sets of
-- canonical tags and a ranking problem we would have made ourselves.
CREATE UNIQUE INDEX "custom_domain_business_id_key" ON "custom_domain" ("business_id");

-- And one business per hostname, or two sellers race for the same address.
CREATE UNIQUE INDEX "custom_domain_hostname_key" ON "custom_domain" ("hostname");

-- A verified domain has a date; an unverified one does not.
ALTER TABLE "custom_domain"
  ADD CONSTRAINT "custom_domain_verified_has_a_date"
  CHECK (("status" = 'verified') = ("verified_at" IS NOT NULL) OR "status" = 'revoked');

-- A cause is only meaningful on a failure, and a failure without one is the
-- "DNS lookup failed" message this flow exists to avoid.
ALTER TABLE "custom_domain"
  ADD CONSTRAINT "custom_domain_failure_has_a_cause"
  CHECK (("status" = 'failed') = ("failure_cause" IS NOT NULL));

-- Never an apex. A CNAME cannot coexist with the SOA and NS records at a zone
-- apex, so accepting one would be a flow that works or does not depending on
-- whether the seller's registrar offers ALIAS records.
ALTER TABLE "custom_domain"
  ADD CONSTRAINT "custom_domain_is_not_apex"
  CHECK (length("hostname") - length(replace("hostname", '.', '')) >= 2);

CREATE INDEX IF NOT EXISTS "custom_domain_poll_idx"
  ON "custom_domain" ("status", "last_checked_at");
