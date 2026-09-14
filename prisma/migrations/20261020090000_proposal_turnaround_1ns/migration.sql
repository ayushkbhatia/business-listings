-- Board `1n-s` — the response time a proposal was sent with.
--
-- The comparison's render carries a row the proposal never collected: *reactive
-- callout · included, 24/7, 4-hour attendance*. That row is facilities words, and
-- a trade the service track has to fit — a tax practice, a customs broker — has no
-- callout. What every scope sheet does have is its required *turnaround* field,
-- which each family names in its own words: *Response time* for on-site
-- maintenance, *Clearance time* for logistics, *Turnaround* elsewhere. That is the
-- row, and it is the supplier's words.
--
-- Copied onto the proposal at send, beside the service's name and fee basis, for
-- the reason those are: a sent proposal is immutable, and a seller editing the
-- sheet afterwards must not change what a buyer is comparing or later accepted.
--
-- **Additive, and ordered to apply ahead of the code.** One nullable column, null
-- on every proposal sent before it, which the comparison reads as *Not stated*.
-- `quote_proposal_immutable` guards updates, and nothing here updates a row.

ALTER TABLE "quote_proposal" ADD COLUMN IF NOT EXISTS "turnaround" TEXT;
