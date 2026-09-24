# Permission matrix — design system §07, boards 7d and 4i

The source of truth for `lib/auth/capabilities.ts`. Every row here is a server-side capability
function. Nothing checks `role === …` inside a component.

`—` = denied. `audit only` = the action is possible but writes an `AuditEvent` with a required
reason and is visible in `/admin/audit`.

---

## 1. Cross-surface matrix (design-system §07)

| Capability | Buyer | Seller | Moderator | Superadmin |
|---|---|---|---|---|
| Send an enquiry / RFQ | ✓ | ✓ | — | — |
| Edit own listing content | — | ✓ | ✓ | ✓ |
| Set verification tier | — | — | — | ✓ |
| Remove a review | — | — | — | ✓ |
| Suspend an account | — | — | — | ✓ |
| See another business's enquiries | — | — | audit only | audit only |

The last row is the one that matters most: support needs it, and it must be impossible to do
silently.

### The buyer with no account, and the two rows this table does not draw

**Buyer includes the buyer who has not signed up** — board 7a `B9`, auth is deferred, not gating.
Sending an enquiry without an account creates a *provisional identity*: a phone number, a profile
row, and a claim token the tracking link carries. It holds **no role** — `createProvisionalIdentity`
gives it none, and claiming it (verifying the mobile) is what grants `buyer` — so no role column can
reach it. The matrix names what it may do instead: `CapabilitySpec.provisional`, which `can()` reads
for an actor `actorFor` marks provisional.

It holds exactly three rows, and `tests/unit/permission-matrix.test.ts` holds the count:

| Capability | Buyer | Buyer with no account | Seller seat | Staff role alone |
|---|---|---|---|---|
| Send an enquiry / RFQ (`enquiry.create`) | ✓ | ✓ | ✓ | — |
| Accept a quote (`quote.accept`) | ✓ | ✓ | ✓ | — |
| Write a review (`review.create`) | ✓ | ✓ | ✓ | — |

The second and third are not rows in §07, which has only "Send an enquiry". They follow it, so that
no seat can start an enquiry it cannot finish — and each is also about one enquiry, which must be the
actor's own: `acceptQuote` and `canReview` check that against the row. A staff member who also buys
holds all three through `buyer`, which board 4i's staff policy keeps.

**Asked in the service, of the record.** `createEnquiry` (and `addSuppliers`), `acceptQuote` (and
the company approval that ends in it), and every path toward a new review — the post, its draft, its
photographs — call the `assertCan*` as their first line, against `actorFor(id)` rather than anything a
caller hands in. A suspended account resolves to an actor holding nothing, so it is refused there
too, and a suspended provisional identity's number cannot send again. None of the three is audited:
a buyer's own act is not a staff decision. Build plan 9.4 is when these were first asked; before it,
the guards had no caller.

---

## 2. Seller roles (board 7d) — four roles

Replaces the `inferred` block in `lib/auth/capabilities.ts`. Note that the dispatch/POD row
from the pre-pivot board is **deleted**, not renamed — there is no order entity.

| Capability | Owner | Manager | Sales | Finance |
|---|---|---|---|---|
| Reply to enquiries & send quotes | ✓ | ✓ | ✓ | — |
| Send a quote revision | ✓ | ✓ | ✓ | — |
| Edit products & specs | ✓ | ✓ | — | — |
| Bulk import / export catalogue | ✓ | ✓ | — | — |
| Edit listing profile, locations, hours | ✓ | ✓ | — | — |
| Upload verification documents | ✓ | ✓ | — | — |
| Reply to a review | ✓ | ✓ | — | — |
| Request reviews from buyers | ✓ | ✓ | ✓ | — |
| See analytics | ✓ | ✓ | own leads only | — |
| See invoices & billing | ✓ | — | — | ✓ |
| Buy sponsored placement | ✓ | — | — | ✓ |
| Change plan or cancel | ✓ | — | — | — |
| Close the account | ✓ | — | — | — |
| Invite or remove team members | ✓ | ✓ | — | — |
| Set lead routing rules | ✓ | ✓ | — | — |

Scoping: a `sales` seat may be branch-scoped, in which case every capability above is further
limited to enquiries and locations for that branch. Board 7d shows Fatima scoped to Al Quoz.
The scope is set on the invitation and copied onto the user when the seat is taken —
`TeamInvite.branchId` to `User.branchId` to `Actor.branchId`. Before board 8d the last two
links did not exist, so `withinScope()` read an always-absent branch and every scoped check
passed. A null branch means the whole business, which is what an owner and most managers are.

Escalation is not a permission — an unanswered enquiry escalates to the owner after the
configured interval regardless of routing. `lib/enquiry/escalation-job.ts` runs it hourly,
reading `Business.leadEscalationMinutes` and sending once per enquiry.

---

## 3. Staff roles (board 4i) — three roles, one retired

| Capability | Ops lead | Moderator | Finance |
|---|---|---|---|
| Approve listings & edits | ✓ | ✓ | — |
| Reject with reason | ✓ | ✓ | — |
| Resolve claim conflicts | ✓ | — | — |
| Set verification tier | ✓ | — | — |
| Edit taxonomy & spec templates | ✓ | — | — |
| Edit notification templates, record Meta's decision (board 12g) | ✓ | — | — |
| Read notification templates and the delivery log (board 12g) | ✓ | ✓ | — |
| Remove a review | ✓ | — | — |
| Resolve a supplier report | ✓ | ✓ | — |
| Suspend an account | ✓ | — | — |
| Issue a subscription credit | — | — | ✓ |
| Edit plans & entitlements, and add a plan (board 12e) | ✓ | — | ✓ |
| Set the sponsored-placement rate card (board 11e) | ✓ | — | ✓ |
| Export finance data | — | — | ✓ |
| Adjust search ranking weights | ✓ | — | — |
| Manual boost / demote a listing | ✓ | — | — |
| View-as a business | ✓ | ✓ | — |
| Work the call list (board 12d) | ✓ | ✓ | — |
| See staff & roles | ✓ | ✓ | ✓ |
| Invite staff, change roles, deactivate | ✓ | — | — |
| Read the audit log | ✓ | own actions | own actions |

**`field verifier` is retired, and retired means removed.** It existed only to record site
visits and set the tier that followed; both are gone. Site visits were withdrawn on 5 Sep
2026, and the grant that followed them was narrowed to the ops lead rather than widened into
an unconditional one. Board 4i then removed `staff_field` from the `role` enum
(migration `20261022091000_retire_field_verifier_4i`) after moving its one holder to
moderator (Q1), so no claim, seed or form can grant it again. `RETIRED_STAFF_ROLES` in
`lib/auth/roles.ts` keeps the history as a plain string, which is what the staff screen's
"1 retired" counts.

**The live matrix is `/admin/staff`.** It is drawn from `lib/auth/capabilities.ts` — the same
table every console gate reads — so this document and the screen cannot disagree unless this
document does. When they do, the code wins and this table is the one to correct.

**One staff role per person.** Finance can move money and cannot moderate anything; a person
holding both would be the combination the board separates. `lib/staff/policy.ts` grants staff
roles one at a time, keeps any non-staff role (an ops lead who also buys stays a buyer), and
refuses a staff role to a supplier seat.

**Three rules a role check cannot express**, enforced in `lib/staff/service.ts` under one
advisory lock: the last active ops lead cannot be demoted or deactivated (criterion 7);
nobody changes their own staff role; and a suspended account gets no new role. Invitations go
only to `STAFF_EMAIL_DOMAINS` (Q3 is open, so a contractor address is refused), expire after
72 hours, and store only a SHA-256 of their token.

**Every ✓ in this table that changes state writes an `AuditEvent` with a non-null reason.**
Ops lead has no exemption.

"Suspend an account" is two capabilities since board 7a, because it is two different acts:
`business.suspend` takes a listing out of the directory and leaves its team signed in;
`account.suspend` stops a person signing in on every role they hold, ends their sessions and
emails them the reason. Both are ops lead only. A staff seat is not suspended — board 4i
deactivates it.

### Rows this document does not contain

Twenty capabilities in `lib/auth/capabilities.ts` carry `source: "inferred"` because §07 has no
row for them, or departs from the row it has. `tests/unit/permission-matrix.test.ts` names all
twenty, so adding a twenty-first is a deliberate edit rather than a quiet default. The eleven
below are the ones with no row at all; `business.verification_tier.write`, `review.dispute`,
`staff.manage`, `staff.read`, board 12g's two notification rows (in the staff table above),
`report.detectors` and the two `contact_lead` rows are explained where the test names them.

| Capability | Held at | Why, and which way it errs |
|---|---|---|
| `business.merge` | ops lead | A merge rewrites slugs and creates 301s, so it is not reversible the way a removal is. |
| `question.remove` | ops lead | A product question carries a buyer's published words. Same decision as removing a review, so the same rung — erring **higher**. |
| `review.hold` | ops lead · moderator | Board 1m's held state, and the only one that errs **lower**. A hold is reversible and a removal is not; putting the reversible pause out of a moderator's reach would push them towards the irreversible control. It writes `review_held` and `review_released` — two actions, because a release logged as a hold hides what happened. |
| `queue.rules` | ops lead | Board 4b's *Tune auto-check rules*. Switching a check off or moving a threshold changes which submissions bulk approve may act on across the whole queue, so it sits a rung above deciding one — erring **higher**. It writes `queue_rules_tuned`. |
| `business.close` | ops lead | Board 11i's platform-initiated closure (build note B8): notice for a lapsed licence, withdrawing an open closure, and reopening a final one for a named owner. Closure takes a business out of the directory and ends every seat's session, so it sits with suspension — erring **higher**. It writes `closure_noticed`, `closure_withdrawn` and `closure_reopened`. |
| `homepage.curate` | ops lead | Board 6h and its Q5, which names the gap: the four "Verified this week" slots and the popular-search chips had no row and borrowed `taxonomy.write`. Four slots against every business in the directory is the highest-leverage placement on the platform, and the cards assert the tier an ops lead owns — erring **higher**. It writes `homepage_slot_featured`, `homepage_slot_removed`, `homepage_slots_reordered`, `homepage_query_added` and `homepage_query_removed`. |
| `strings.write` | ops lead | Board 12g-s. `/admin/strings` borrowed `taxonomy.write` while it was a report; the paired view writes the half of a string every business of one kind reads, on every screen carrying the key, the moment it is saved and without a deploy — and suppressing a half removes a control from all of them. Held where "Edit taxonomy & spec templates" is — erring **higher**. It writes `string_written`, `string_suppressed` and `string_restored`. |
| `taxonomy.read` | ops lead · moderator | Board 4d. A non-ops-lead admin sees the taxonomy read-only — it is how other staff answer "why does this seller see that screen", and the moderator decides category changes in the approval queue against this tree. Reading changes nothing, so it is not audited — erring **lower** on a read. |
| `taxonomy.merge` | ops lead | Board 4d Q4. A merge moves every listing, product and service under one category into another and writes a redirect for every address the absorbed one owned; it cannot be undone by editing a field. Its own capability so narrowing or widening it touches one row — erring **higher**. |
| `quote.accept` | buyer · every seller seat · provisional | Build plan 9.4. Was marked `stated` and buyer-only with no row to state it. Asked, it refused the provisional identity most enquiries belong to, and a supplier's seat on the enquiry §07 lets it send. It follows `enquiry.create` — erring **lower**, to the principals the product already lets send. |
| `review.create` | buyer · every seller seat · provisional | Build plan 9.4, for the same reasons. Whether an enquiry earned a review is board 10f's gate (`canReview`), not a role; a competitor posing as a customer is the `no_traceable_enquiry` dispute ground. Erring **lower**, to the same principals. |

If §07 gains a row for any of these, the row wins and the `source` becomes `stated`.

---

## 4. Buyer company roles (board 7b) — three roles

Buyer-side and separate from table 3 by construction (`B12`): a different Postgres type
(`buyer_company_role`), read from `buyer_company_member` under the company's lock, never from an
`Actor` role or a session claim. `lib/buyer-company/guard.ts` is the one way into a company write,
and `lib/buyer-company/authority.ts` decides every approval question.

| Capability | Admin | Procurement | Requester |
|---|---|---|---|
| Send an enquiry for the company | ✓ | ✓ | ✓ |
| Accept a quote without approval | any value, within the rule | within what is left of their monthly limit, within the rule | — |
| Approve a colleague's request | ✓ (named approver only above the threshold) | when their remaining month covers it | — |
| Query a request | ✓ | when they may approve it | — |
| Edit company details, addresses, team, rule | ✓ | — | — |
| See the company page, the rule, the team, the spend | ✓ | ✓ | ✓ |
| See a request's detail | ✓ | raiser, or may approve | raiser |

**Nobody approves their own request.** Where the named approver raises one the rule holds,
another admin approves; with no other admin, nobody can, and the rule card says so.

**No finance role.** The board drew *Finance — approves invoices only*; there is no buyer-side
invoice surface for it to approve on (Q2), so the role is not offered.

**The last admin and the named approver cannot be demoted, deactivated or leave** — the first
would leave a company nobody can administer, the second a rule naming somebody who cannot approve.

None of these writes `AuditEvent` — that log is staff decisions. Each writes a
`buyer_company_event` in the same transaction, read by the company on
`/account/company/history` (`B8`).

---

## Implementation notes

One function per capability, named for the capability: `canSetVerificationTier(actor, business)`,
not `isOpsLead(actor)`. Role is an input, never the check itself — three of the rows above are
subject-dependent and a role-only check gets them wrong.

Criterion 9 in handoff 3 should assert against table 2, and criterion 6 in handoff 2 against
table 1.
