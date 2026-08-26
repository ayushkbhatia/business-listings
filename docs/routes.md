# Routes — all three surfaces

Every route the canvas defines. Board ids in brackets refer to the screen canvas.
Routes marked `later` are named so the router and nav config are shaped correctly now;
they 404 until their handoff.

## Public — businesslistings.me

```
/                                       Directory home                        [1a]
/c/:category                            Category browse + filters             [1b]
/c/:category/:sub                       Subcategory                          [10a]
/search?q&emirate&verified&tab          Results, businesses tab               [1c]
/search?tab=products                    Results, products tab                [10c]
/compare?p=…                            Comparison tray                      [10d]
/b/:slug                                Storefront overview                   [1d]
/b/:slug/products                       Catalogue                             [1e]
/b/:slug/branches                       Branches & hours                      [1f]
/b/:slug/reviews                        Reviews                               [1m]
/b/:slug/p/:product                     Product + spec table                  [1g]
/b/:slug (unclaimed variant)            Unclaimed listing                    [10g]
/rfq/new                                RFQ fan-out                           [1h]  built h2s3
/enquiry/:id                            Enquiry sent + tracking               [1i]  built h2s3
/enquiry/:id/compare                    Compare quotes                        [1n]  built h2s3
/enquiry/:id/accepted                   Accepted quote record                 [7c]  built h2s3
/enquiry/:id/thread/:seller             Negotiation thread                   [10h]  built h2s4
/pricing                                Plans                                 [1l]
/guides                                 Guide index                          [10b]
/guides/:slug                           Guide article                         [6d]
/best/:slug                             Curated list                          [6b]
/categories                             Category index                        [6c]
/:emirate/:area/:category               Area landing page                     [6a]
/lp/:campaign                           Campaign landing                     [10i]
/report/:subject                        Report a listing (modal route)       [10j]
/terms · /privacy · /verification-policy · /review-policy                    [10j]
/signin · /signup · /verify · /reset                                          [7a]  built h2s2
/account/enquiries                      Buyer enquiry inbox                  [10e]  built h2s3
/account/saved                          Saved searches & alerts              [10e]
/account/suppliers                      Saved suppliers                       later
/account/requirements                   Saved requirements                    later
/account/company                        Company, TRN, team, approvals         [7b]
/review/new?enq=                        Write a review                       [10f]  built h2s6
```

## Tenant — /dashboard

```
/onboarding/claim                       Find or add the business              [2a]
/onboarding/verify                      Prove ownership                       [2b]
/onboarding/profile                     Profile basics                        [2c]
/onboarding/locations                   Locations & hours                     [2d]
/onboarding/plan                        Pick a plan                           [2e]
/dashboard                              Overview                              [3a]
/dashboard (free variant)               Free-plan overview                   [11a]
/dashboard/setup                        Setup hub                             [8a]
/dashboard/setup/photos                 Task 1                                [8b]
/dashboard/setup/products               Task 2                                [8c]
/dashboard/setup/team                   Task 3                                [8d]
/dashboard/setup/visit                  Task 4 + done                         [8e]
/dashboard/listing                      Listing profile                       [3b]
/dashboard/locations                    Locations                             [3c]
/dashboard/hours                        Hours & Ramadan                       [3d]
/dashboard/verification                 Verification & documents              [3e]
/dashboard/products                     Catalogue                             [3f]
/dashboard/products/:sku                Product editor                        [3g]
/dashboard/products/import              CSV import mapper                    [11d]
/dashboard/templates/:slug              Spec template                         [3h]
/dashboard/media                        Media library                         [3i]
/dashboard/leads                        Leads & RFQ inbox                     [3j]  built h2s1
/dashboard/leads/:id/thread             Seller message thread                [11b]  built h2s1 + h2s4
/dashboard/quotes                       Quotes sent pipeline                  [3k]  built h2s1
/dashboard/reviews                      Reviews                              [11c]  built h2s6
/dashboard/analytics                    Analytics                             [3l]
/dashboard/billing                      Subscription & invoices               [3m]
/dashboard/billing/change               Plan change                          [11f]
/dashboard/billing/cancel               Cancel                               [11f]
/dashboard/invoice/:id                  Tax invoice                          [11f]
/dashboard/promote                      Sponsored placement                  [11e]
/dashboard/team                         Team & lead routing                   [7d]
/dashboard/settings                     Settings & notifications              [7e]  built h2s5 (alerts only)
```

## Superadmin — /admin

```
/admin                                  Platform overview                     [4a]  built h4s0
/admin/queue                            Approval queue                        [4b]
/admin/queue/:id                        Review a submission                   [4c]
/admin/queue/conflict/:id               Resolve a conflicting claim           [4c]
/admin/ingest                           Licence importer                     [12a]  built h4s2
/admin/ingest/:id                       One import run                       [12a]  built h4s2
/admin/ingest/dedupe                    Dedupe & merge                       [12b]
/admin/search                           Ranking, boosts, routing             [12c]
/admin/categories                       Taxonomy                              [4d]
/admin/spec-library                     Spec templates                        [4e]
/admin/attributes                       Attribute dictionary                  later
/admin/businesses                       Businesses & health                   [4f]
/admin/crm                              Recruitment & accounts               [12d]
/admin/users                            Users                                later
/admin/staff                            Staff, roles & audit                  [4i]
/admin/subscriptions                    Subscriptions                         [4g]
/admin/invoices                         Invoices & credits                   [12e]
/admin/plans                            Plans & entitlements                 [12e]
/admin/dunning                          Failed payments                      [12e]
/admin/tax                              VAT export                           [12e]
/admin/revenue                          Revenue                               [4g]
/admin/reports                          Supplier reports & flags              [4h]
/admin/support                          Support desk & view-as               [12f]
/admin/notifications                    Notification templates              [12g]
/admin/strings                          Localisation                         [12g]
/admin/content/matrix                   SEO page matrix                       [6f]
/admin/content/home                     Homepage curation                    [12g]
/admin/content/redirects                Redirects                            [12g]
/admin/storefront-templates/*           Storefront builder            [5a–5e, 5g, 5h]
/admin/visits                           Field visit scheduling               [12h]
/admin/areas                            Emirates, areas, free zones          [12h]
/admin/api                              API keys & webhooks                  [12h]
/admin/compliance                       PDPL data requests                   [12h]
/admin/audit                            Audit log                             [4i]
```

## Development surfaces

Not part of any of the three products. They exist so a person can see every
state at once, which is the only way to notice that two of them disagree.

```
/dev/gallery                            Every component, every state          built h0-h2
/dev/notifications                      Notification templates rendered [7f]  built h2s5
```

## Rules

Slugs are immutable once published. Renaming a category or merging two listings creates a
301 automatically; deleting a page without one is blocked at the service layer.

Area landing pages and subcategory pages publish only above the thresholds in board 6f:
60 listings, 30% verified, 250 words of intro copy. They auto-unpublish if supply drops
below the floor. This is enforced in code, not by editorial discipline.
