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
| Request a site visit | ✓ | — | — | — |
| Reply to a review | ✓ | ✓ | — | — |
| Request reviews from buyers | ✓ | ✓ | ✓ | — |
| See analytics | ✓ | ✓ | own leads only | — |
| See invoices & billing | ✓ | — | — | ✓ |
| Buy sponsored placement | ✓ | — | — | ✓ |
| Change plan or cancel | ✓ | — | — | — |
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

## 3. Staff roles (board 4i) — four roles

| Capability | Ops lead | Moderator | Field verifier | Finance |
|---|---|---|---|---|
| Approve listings & edits | ✓ | ✓ | — | — |
| Reject with reason | ✓ | ✓ | — | — |
| Resolve claim conflicts | ✓ | — | — | — |
| Set verification tier | ✓ | — | ✓ | — |
| Record a site visit | ✓ | — | ✓ | — |
| Edit taxonomy & spec templates | ✓ | — | — | — |
| Edit storefront templates | ✓ | — | — | — |
| Remove a review | ✓ | — | — | — |
| Resolve a supplier report | ✓ | ✓ | — | — |
| Suspend an account | ✓ | — | — | — |
| Issue a subscription credit | — | — | — | ✓ |
| Edit plans & entitlements | ✓ | — | — | ✓ |
| Export VAT / finance data | — | — | — | ✓ |
| Adjust search ranking weights | ✓ | — | — | — |
| Manual boost / demote a listing | ✓ | — | — | — |
| View-as a business | ✓ | ✓ | — | — |
| Read the audit log | ✓ | own actions | own actions | own actions |

`field verifier` can set a tier only as the result of a visit they recorded — it is not a
general grant. Enforce with a subject check, not just a role check.

**Every ✓ in this table that changes state writes an `AuditEvent` with a non-null reason.**
Ops lead has no exemption.

### Rows this document does not contain

Three capabilities in `lib/auth/capabilities.ts` carry `source: "inferred"` because §07 has no
row for them. `tests/unit/permission-matrix.test.ts` names all of them, so adding a fourth is
a deliberate edit rather than a quiet default.

| Capability | Held at | Why, and which way it errs |
|---|---|---|
| `business.merge` | ops lead | A merge rewrites slugs and creates 301s, so it is not reversible the way a removal is. |
| `question.remove` | ops lead | A product question carries a buyer's published words. Same decision as removing a review, so the same rung — erring **higher**. |
| `review.hold` | ops lead · moderator | Board 1m's held state, and the only one that errs **lower**. A hold is reversible and a removal is not; putting the reversible pause out of a moderator's reach would push them towards the irreversible control. It writes `review_held` and `review_released` — two actions, because a release logged as a hold hides what happened. |

If §07 gains a row for any of these, the row wins and the `source` becomes `stated`.

---

## Implementation notes

One function per capability, named for the capability: `canSetVerificationTier(actor, business)`,
not `isOpsLead(actor)`. Role is an input, never the check itself — three of the rows above are
subject-dependent and a role-only check gets them wrong.

Criterion 9 in handoff 3 should assert against table 2, and criterion 6 in handoff 2 against
table 1.
