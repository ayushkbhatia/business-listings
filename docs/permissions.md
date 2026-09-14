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
| Build or edit a storefront template | — | — | — | ✓ |
| Pick a theme preset for own storefront | — | ✓ | — | ✓ |
| Remove a review | — | — | — | ✓ |
| Suspend an account | — | — | — | ✓ |
| See another business's enquiries | — | — | audit only | audit only |

The last row is the one that matters most: support needs it, and it must be impossible to do
silently.

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
| Pick a theme preset | ✓ | ✓ | — | — |
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
| Edit storefront templates | ✓ | — | — |
| Edit notification templates, record Meta's decision (board 12g) | ✓ | — | — |
| Read notification templates and the delivery log (board 12g) | ✓ | ✓ | — |
| Remove a review | ✓ | — | — |
| Resolve a supplier report | ✓ | ✓ | — |
| Suspend an account | ✓ | — | — |
| Issue a subscription credit | — | — | ✓ |
| Edit plans & entitlements | ✓ | — | ✓ |
| Export VAT / finance data | — | — | ✓ |
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

Twelve capabilities in `lib/auth/capabilities.ts` carry `source: "inferred"` because §07 has no
row for them, or departs from the row it has. `tests/unit/permission-matrix.test.ts` names all
twelve, so adding a thirteenth is a deliberate edit rather than a quiet default. The six below
are the ones with no row at all; `business.verification_tier.write`, `review.dispute`,
`staff.manage`, `staff.read` and board 12g's two notification rows (in the staff table above)
are explained where the test names them.

| Capability | Held at | Why, and which way it errs |
|---|---|---|
| `business.merge` | ops lead | A merge rewrites slugs and creates 301s, so it is not reversible the way a removal is. |
| `question.remove` | ops lead | A product question carries a buyer's published words. Same decision as removing a review, so the same rung — erring **higher**. |
| `review.hold` | ops lead · moderator | Board 1m's held state, and the only one that errs **lower**. A hold is reversible and a removal is not; putting the reversible pause out of a moderator's reach would push them towards the irreversible control. It writes `review_held` and `review_released` — two actions, because a release logged as a hold hides what happened. |
| `queue.rules` | ops lead | Board 4b's *Tune auto-check rules*. Switching a check off or moving a threshold changes which submissions bulk approve may act on across the whole queue, so it sits a rung above deciding one — erring **higher**. It writes `queue_rules_tuned`. |
| `business.close` | ops lead | Board 11i's platform-initiated closure (build note B8): notice for a lapsed licence, withdrawing an open closure, and reopening a final one for a named owner. Closure takes a business out of the directory and ends every seat's session, so it sits with suspension — erring **higher**. It writes `closure_noticed`, `closure_withdrawn` and `closure_reopened`. |
| `homepage.curate` | ops lead | Board 6h and its Q5, which names the gap: the four "Verified this week" slots and the popular-search chips had no row and borrowed `taxonomy.write`. Four slots against every business in the directory is the highest-leverage placement on the platform, and the cards assert the tier an ops lead owns — erring **higher**. It writes `homepage_slot_featured`, `homepage_slot_removed`, `homepage_slots_reordered`, `homepage_query_added` and `homepage_query_removed`. |

If §07 gains a row for any of these, the row wins and the `source` becomes `stated`.

---

## Implementation notes

One function per capability, named for the capability: `canSetVerificationTier(actor, business)`,
not `isOpsLead(actor)`. Role is an input, never the check itself — three of the rows above are
subject-dependent and a role-only check gets them wrong.

Criterion 9 in handoff 3 should assert against table 2, and criterion 6 in handoff 2 against
table 1.
