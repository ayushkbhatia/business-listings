import "server-only";
import { prisma } from "@/lib/db/client";
import { channelOf, contactLabel } from "./contact";
import { sendInvite } from "./invite-email";
import { repairClaims } from "@/lib/auth/flow";
import { can } from "@/lib/auth/can";
import { assertCanManageTeam } from "@/lib/auth/guards";
import { SELLER_ROLES, type Actor, type Role } from "@/lib/auth/roles";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * Accepting a seat, expiring an offer, and taking a seat back.
 *
 * The missing middle of board 7d. `inviteSeat` in service.ts wrote a
 * `TeamInvite` row with a token, and nothing in the codebase ever read that
 * token back: `acceptedAt` had no writer, there was no route under `/invite`,
 * and the action that created the row discarded the token it was handed. So the
 * only self-service way to put a second person on a listing was a flow that
 * could be started and never finished — which is also why the setup hub's
 * "invite somebody" task was uncompletable through the product.
 *
 * **The authority here is the token, not a capability.** An invitee holds no
 * seller role, has no `businessId`, and often has no account at all until they
 * follow the link, so there is nothing to `assertCan` against. `acceptInvite`
 * checks three other things in its place: the token's own state, that the
 * signed-in address is the invited one, and that the person is not already
 * seated on another business. `removeSeat` is the opposite case and does assert
 * — it is an owner acting on their own team.
 *
 * **No audit row on either.** `AuditEvent` records staff decisions, and
 * non-negotiable 3 is about staff state changes; a supplier moving somebody on
 * or off their own team is neither. `inviteSeat` writes none for the same
 * reason, and adding one here would put a seller's routine housekeeping in the
 * log staff read for moderation decisions.
 */

/**
 * What an invitation may grant, restated at the moment it is redeemed.
 *
 * `inviteSeat` filters the form's roles to the same set before it writes the
 * row, so this looks redundant — and it is the check that matters. The stored
 * `roles` array is what the accept path reads, a row can outlive the code that
 * wrote it, and a seat that granted `seller_owner` because an old row said so
 * would hand a listing away. Derived from `SELLER_ROLES` rather than written
 * out a second time so the two lists cannot drift.
 *
 * `seller_owner` is excluded for the reason inviteSeat gives: transferring
 * ownership is a different act with different consequences, and it does not
 * belong behind an invite form.
 */
const OFFERABLE: readonly Role[] = SELLER_ROLES.filter((role) => role !== "seller_owner");

function isOfferable(role: string): role is Role {
  return (OFFERABLE as readonly string[]).includes(role);
}

// ── Reading a token ─────────────────────────────────────────────────────────

export type InviteRefusalState = "not_found" | "expired" | "revoked" | "already_used";

export interface InviteOffer {
  state: "ok";
  businessId: string;
  /**
   * `displayName`, always. A seat is offered on the name a buyer sees on the
   * storefront the invitee is about to answer enquiries for; the trade name
   * reaches exactly one surface and this is not it.
   */
  businessName: string;
  /** Who sent it. Falls back to the business where the sender has no name on file. */
  inviterName: string;
  /** The address the offer is bound to. Lowercased at creation. */
  /** The address or the mobile, whichever the invitation was sent to. */
  contact: string;
  channel: "whatsapp" | "email";
  roles: Role[];
  /**
   * The branch the seat is scoped to, or null for the whole business.
   *
   * Read here so `acceptInvite` can copy it onto the user in the same
   * transaction that grants the seat. `Actor.branchId` has been declared since
   * handoff 0 and read by `withinScope()` ever since with nothing writing it,
   * so every branch-scoped check returned true. This is the writer.
   */
  branchId: string | null;
  expiresAt: Date;
}

/**
 * The two refusals that name the supplier, and the two that do not.
 *
 * `expired` and `revoked` both mean "this was a real invitation, from them, to
 * you" — the copy for each sends the reader back to the supplier to ask, which
 * it cannot do without saying who. `not_found` and `already_used` say nothing
 * about anybody, which is what keeps a guessed token from being a probe: it
 * answers the same way for a token that never existed as for one that did.
 */
export type InviteView =
  | { state: "not_found" }
  | { state: "already_used" }
  | { state: "expired"; businessName: string }
  | { state: "revoked"; businessName: string }
  | InviteOffer;

/**
 * A token, resolved to one of five states and nothing else.
 *
 * An invitation link is unauthenticated by design, which makes it a probe as
 * well as a door: anybody can put a string after `/invite/` and read the
 * answer. So a token that was never issued learns nothing whatever — not a
 * name, not whether the id it encodes exists, not how it differs from a token
 * that has already been spent. The three states that do name a supplier all
 * require a row that supplier actually wrote to an address they chose.
 */
export async function readInvite(token: string, now: Date = new Date()): Promise<InviteView> {
  if (!token) return { state: "not_found" };

  const invite = await prisma.teamInvite.findUnique({
    where: { token },
    select: {
      businessId: true,
      email: true,
      phone: true,
      roles: true,
      branchId: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      business: { select: { displayName: true } },
      invitedBy: { select: { fullName: true } },
    },
  });

  if (!invite) return { state: "not_found" };

  /*
     Expiry is read before revocation, and the order is load-bearing.

     `expireInvites` marks a lapsed offer `revokedAt` so it stops counting
     against the seat cap. Checking `revokedAt` first would then tell everybody
     whose invite simply ran out that it "was withdrawn" — that somebody
     changed their mind about them — which is a different thing to be told and
     is not true. Expiry is a date passing; revocation is a person deciding.
  */
  if (invite.acceptedAt) return { state: "already_used" };
  if (invite.expiresAt <= now) {
    return { state: "expired", businessName: invite.business.displayName };
  }
  if (invite.revokedAt) {
    return { state: "revoked", businessName: invite.business.displayName };
  }

  return {
    state: "ok",
    businessId: invite.businessId,
    businessName: invite.business.displayName,
    inviterName: invite.invitedBy.fullName ?? invite.business.displayName,
    contact: contactLabel(invite),
    channel: channelOf(invite),
    // Filtered through the same ceiling the accept path applies, so the screen
    // shows what will actually be granted rather than what the row happens to
    // hold.
    roles: invite.roles.filter(isOfferable),
    branchId: invite.branchId,
    expiresAt: invite.expiresAt,
  };
}

/** The role names, in the catalogue's words. For a screen and for an email. */
export function describeRoles(roles: readonly Role[]): string {
  return roles.map((role) => t(`team.role.${role}` as MessageKey)).join(", ");
}

// ── Who is holding the link ─────────────────────────────────────────────────

export interface SeatHolder {
  email: string | null;
  phone: string | null;
  roles: Role[];
  businessId: string | null;
  /** `displayName` of the business they already sit on, where they sit on one. */
  businessName: string | null;
}

/**
 * The signed-in person's own row.
 *
 * The accept screen needs three facts before it can offer a button: the address
 * they are signed in with, whether they already hold a seat, and whose. All
 * three are their own, so reading them leaks nothing — and knowing them at
 * render time means the two refusals a person cannot do anything about are
 * shown before they click rather than after.
 *
 * It carries `roles` as well, which the screen does not use and `acceptInvite`
 * does. One row read once: the roles a seat is added to are on the same record
 * as the address it is checked against, and fetching them separately would be a
 * second round trip for a column already in hand.
 *
 * `Actor` carries no email. It never has: roles and a business id are what a
 * permission decision needs, and an address is not one.
 */
export async function seatOf(actorId: string): Promise<SeatHolder | null> {
  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: {
      email: true,
      phone: true,
      roles: true,
      businessId: true,
      business: { select: { displayName: true } },
    },
  });
  if (!user) return null;

  return {
    email: user.email,
    phone: user.phone,
    roles: user.roles,
    businessId: user.businessId,
    businessName: user.business?.displayName ?? null,
  };
}

// ── Accepting ───────────────────────────────────────────────────────────────

export type AcceptRefusal =
  | { reason: InviteRefusalState }
  | { reason: "wrong_account"; invitedEmail: string; signedInAs: string }
  | { reason: "other_business"; otherBusinessName: string };

export type AcceptResult =
  | { ok: true; businessId: string; businessName: string; roles: Role[] }
  | ({ ok: false } & AcceptRefusal);

/**
 * Take the seat.
 *
 * Refusals travel as tokens rather than sentences, the same way `inviteSeat`
 * reports its plan cap: this layer knows the state, the screen knows the words,
 * and neither has to know the other's.
 *
 * Two of them are worth stating plainly rather than folding into a generic
 * "cannot accept":
 *
 *   - **Wrong address.** An invitation is to a person, not to whoever opens the
 *     link. A forwarded email is the ordinary case, and a seat that landed on
 *     whoever clicked first would be a seat granted to a mailing list.
 *   - **Already seated elsewhere.** `User.businessId` is a single column, so
 *     accepting would silently move somebody off the listing they are on —
 *     taking their access to its enquiries with them, without telling either
 *     supplier. That is a decision two owners have to make, not a side effect of
 *     a click.
 */
export async function acceptInvite(
  token: string,
  actor: Actor,
  now: Date = new Date(),
): Promise<AcceptResult> {
  const offer = await readInvite(token, now);
  if (offer.state !== "ok") return { ok: false, reason: offer.state };

  const holder = await seatOf(actor.id);
  if (!holder) {
    /*
       A session with no profile row behind it. `adoptProfile` creates one on the
       first successful verification, so this is a broken invariant rather than
       something a person did — and a refusal screen that told them to check
       their address would send them round a loop that cannot end. Throwing puts
       it in the log as the bug it is.
    */
    throw new Error(`No profile row for the signed-in actor ${actor.id}; cannot accept an invite`);
  }

  /*
     Both sides normalised before they are compared. `inviteSeat` lowercases the
     address it stores, so this is belt and braces — and the braces matter: a row
     written by any other path with a capital in it would be an invitation that
     silently never matched anybody, which looks exactly like a broken link.
  */
  /*
     Matched on whichever channel the invitation used.

     An invitation to a mobile is accepted by the account holding that mobile,
     and one to an address by the account holding it. Comparing only the address
     — which is what this did while `email` was NOT NULL — would refuse every
     WhatsApp invitation the moment they existed, and the refusal reads exactly
     like a broken link.
  */
  const invited = offer.contact.trim().toLowerCase();
  const holds = [holder.email, holder.phone]
    .filter((value): value is string => typeof value === "string" && value !== "")
    .map((value) => value.trim().toLowerCase());

  if (!holds.includes(invited)) {
    return {
      ok: false,
      reason: "wrong_account",
      invitedEmail: offer.contact,
      // An account with neither has nothing to compare, and saying so is more
      // use than an empty quotation mark.
      signedInAs: holder.email ?? holder.phone ?? "",
    };
  }

  if (holder.businessId && holder.businessId !== offer.businessId) {
    return {
      ok: false,
      reason: "other_business",
      otherBusinessName: holder.businessName ?? "",
    };
  }

  /*
     The ceiling, applied. Their existing roles are kept — somebody who was a
     buyer stays one, and their enquiries stay theirs — and the invite's roles
     are added on top. Nothing else is granted, which is the whole reason the
     roles live on the invite row rather than being chosen at acceptance.
  */
  const nextRoles: Role[] = Array.from(new Set<Role>([...holder.roles, ...offer.roles]));

  const seated = await prisma.$transaction(async (tx) => {
    /*
       The guard restated at the write, not trusted from the read above.

       Between `readInvite` and here the owner can revoke, the sweep can expire
       it, or the invitee can double-click the button — and a second acceptance
       that found `acceptedAt` already set would re-stamp it and hide that the
       first one happened. `updateMany` with the full condition refuses instead,
       and its count is what actually changed.
    */
    const claimed = await tx.teamInvite.updateMany({
      where: {
        token,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now },
    });
    if (claimed.count === 0) return false;

    await tx.user.update({
      where: { id: actor.id },
      data: {
        businessId: offer.businessId,
        roles: nextRoles,
        /*
           The branch, copied from the offer onto the person.

           This is the only writer of `User.branchId`, and without it the column
           the whole scoping mechanism reads would stay null on every seat ever
           granted — `withinScope()` treats a null branch as "the whole
           business", so a sales seat invited to Al Quoz would silently see
           Sharjah's enquiries too. An unscoped invitation stores null, which
           means the same thing deliberately rather than by omission.
        */
        branchId: offer.branchId,
      },
    });
    return true;
  });

  if (!seated) return { ok: false, reason: "already_used" };

  /*
     The claim, immediately.

     `getActor` reads roles from the JWT `app_metadata` first and only falls
     back to the profile row when the claim is empty — so a seat written here
     and left unsynced would be a seat that does not exist until the session is
     rebuilt. The invitee's very next request is the dashboard they were just
     sent to, and it would 404. `repairClaims` swallows its own failure, and
     `getActor` re-syncs a stale claim on the request after that, so this is the
     fast path rather than the only one.
  */
  await repairClaims(actor.id, nextRoles, offer.businessId);

  return {
    ok: true,
    businessId: offer.businessId,
    businessName: offer.businessName,
    roles: offer.roles,
  };
}

// ── Expiring ────────────────────────────────────────────────────────────────

/**
 * Mark every offer that has run out as withdrawn. Returns how many moved.
 *
 * Not tidiness. `inviteSeat` counts pending invitations against the plan's seat
 * cap with `{ acceptedAt: null, revokedAt: null }` and no date condition, so an
 * invitation nobody accepted keeps occupying a seat forever: a one-seat
 * supplier who invited somebody in March and was never answered can never
 * invite anybody again, and the message they get is that their plan is full.
 * `pendingInvites` already filters expired rows out of the screen, so the seat
 * is spent on a row the owner cannot even see to revoke.
 *
 * One statement, carrying every condition it depends on. There is no read to
 * race with here, and `revokedAt: null` is what makes a second run change
 * nothing — a sweep that rewrote the timestamp each night would move the
 * withdrawal date of an invitation nobody touched.
 *
 * It never touches an accepted invitation. `acceptedAt` is the record that
 * somebody took the seat, and it has to survive the offer lapsing.
 */
export async function expireInvites(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.teamInvite.updateMany({
    where: { expiresAt: { lt: now }, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  return count;
}

// ── Removing ────────────────────────────────────────────────────────────────

export type RemoveResult =
  | { ok: true; name: string; movedLeads: number; movedTo: string | null }
  | { ok: false; error: string };

/** Where the leaver's open leads go. 7d §6.3 — a choice, never a default. */
export interface RemoveOptions {
  /**
   * The seat that takes their open leads, or `null` for the unassigned queue.
   *
   * There is no third option. "Leave them where they are" would point every one
   * of those leads at somebody with no business id, which is a lead assigned to
   * nobody that does not appear in the unassigned scope either — the orphan 7d
   * §6.3 calls the same failure as an unroutable lead.
   */
  reassignToId: string | null;
}

/**
 * Take a seat back. The inverse docs/permissions.md has always named.
 *
 * §07 lists "Invite or remove team members" against the owner, and nothing in
 * the product removed anybody — a seat, once granted, was permanent, which
 * makes the invite form a one-way door and leaves a departed employee holding
 * every enquiry, quote and buyer contact on the listing.
 *
 * **Who may.** `assertCanManageTeam`, and nothing else. `team.manage` is owner
 * *and manager* in lib/auth/capabilities.ts, which says why at length: it was
 * inferred as owner-only on the theory that seats cost money, and "a manager who
 * cannot add the person who answers enquiries is a manager who has to ask the
 * owner every time". Removal is the same sentence in docs/permissions.md §07 as
 * invitation, so it cannot be held to a narrower role than the invitation it
 * undoes — and re-deciding it here with a role comparison is exactly what
 * guards.ts exists to stop. The owner is protected by the check below instead,
 * which is a rule about the *subject* rather than about the actor.
 *
 * **Their work stays.** The seat is cleared by nulling `businessId` and
 * dropping the seller roles; the `User` row itself is never deleted, and that
 * is deliberate rather than incidental. `Message.sender` is
 * `onDelete: Cascade`, so deleting the person would take their half of every
 * negotiation thread with them — a buyer would open a conversation and find
 * only their own messages, and the response times measured from those replies
 * would silently change. `Message.businessId` is its own column, so the
 * supplier keeps the thread either way.
 *
 * **Their open leads move first.** 7d §6.3: "not remove a seat with open leads
 * silently — removal reassigns first: pick a seat or send them to the
 * unassigned queue. An orphaned lead is the same failure as an unroutable one."
 * Both writes are one transaction, because the half-done version is the failure
 * it is guarding against: a seat cleared while its leads still point at it
 * leaves them assigned to somebody with no business, which is invisible in
 * every scope board 3j offers — not `mine`, not `unassigned`, not the seat
 * filter, since the seat is gone from it.
 */
export async function removeSeat(
  actor: Actor,
  userId: string,
  options: RemoveOptions = { reassignToId: null },
): Promise<RemoveResult> {
  assertCanManageTeam(actor);

  if (userId === actor.id) {
    // The owner removing themselves would leave a business with no seat that
    // can invite anybody back, which is not a state anything else can repair.
    return { ok: false, error: t("invite.cannot_remove_self") };
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, email: true, roles: true, businessId: true },
  });

  if (!target || !actor.businessId || target.businessId !== actor.businessId) {
    return { ok: false, error: t("error.permission", { code: "team.manage" }) };
  }

  if (target.roles.includes("seller_owner")) {
    return { ok: false, error: t("invite.cannot_remove_owner") };
  }

  /*
     Seller roles go, everything else stays.

     Somebody who answered enquiries for a supplier is often also a buyer, and
     stripping the lot would take their own enquiry history's access with the
     seat. Derived from `SELLER_ROLES` so a role added later is dropped here
     too — a leftover seller role with no business behind it is a capability
     scoped to nothing, and `can()` would still grant it.
  */
  const nextRoles = target.roles.filter(
    (role): role is Role => !(SELLER_ROLES as readonly string[]).includes(role),
  );

  const businessId = actor.businessId;

  /*
     Checked before the transaction opens, and checked against this team.

     A posted id is a suggestion. Without this a seller could hand their whole
     inbox to a stranger's user id, and the recipient rows carry no second
     check — `EnquiryRecipient.assignedToId` has no constraint tying it to the
     business the enquiry was fanned out to.
  */
  if (options.reassignToId !== null) {
    if (options.reassignToId === userId) {
      return { ok: false, error: t("team.reassign_to_leaver") };
    }
    const taker = await prisma.user.findUnique({
      where: { id: options.reassignToId },
      select: { businessId: true, roles: true, suspendedAt: true },
    });
    if (!taker || taker.businessId !== businessId) {
      return { ok: false, error: t("team.reassign_unknown") };
    }
    /*
       A lead handed to a seat that cannot open it is the orphan again, one door
       along: `enquiry.respond` is what board 3j's inbox is gated on, so a
       finance seat holding twelve leads is twelve leads nobody can answer.
    */
    if (
      taker.suspendedAt !== null ||
      !can({ id: options.reassignToId, roles: taker.roles, businessId }, "enquiry.respond")
    ) {
      return { ok: false, error: t("team.reassign_cannot_reply") };
    }
  }

  const now = new Date();

  const movedLeads = await prisma.$transaction(async (tx) => {
    /*
       Every lead they hold, not only the open ones.

       The rule is about open leads and the count on the confirmation is the
       open count, because that is what the seller is deciding about. The write
       is wider on purpose: a won lead still assigned to somebody with no
       business id is an outcome attributed to a seat that is no longer on the
       team, and board 3j's `Won` tab would render an assignee it cannot name.
    */
    const { count } = await tx.enquiryRecipient.updateMany({
      where: { businessId, assignedToId: userId },
      data:
        options.reassignToId === null
          ? { assignedToId: null, assignedAt: null }
          : {
              assignedToId: options.reassignToId,
              assignedAt: now,
              assignedById: actor.id,
              // The constraint refuses a routed-nowhere reason on an assigned
              // row, and it is right to: the lead has somewhere to be now.
              unroutedReason: null,
            },
    });

    /*
       7d §8.3 — "round-robin state must survive a seat being removed
       mid-rotation". `nextAfter` already restarts the rotation when the cursor
       names nobody eligible, so this is not what makes it survive; it is what
       stops the column pointing at a person who is not on the team, which the
       next reader of it would have to guess about.
    */
    await tx.business.updateMany({
      where: { id: businessId, routingCursorId: userId },
      data: { routingCursorId: null },
    });

    // The seat's own channels go with the seat. They are addresses for a
    // business this person is no longer on, and leaving them would keep
    // `reachabilityFor` answering about somebody who cannot open a lead.
    await tx.seatChannel.deleteMany({ where: { userId } });

    await tx.user.update({
      where: { id: userId },
      // The branch goes with the seat. A cleared `businessId` and a surviving
      // `branchId` would leave a pointer at a location belonging to a business
      // this person is no longer on — and the next seat they take somewhere else
      // would start already scoped to a stranger's branch.
      data: { businessId: null, roles: nextRoles, branchId: null },
    });

    return count;
  });

  // Same reason as acceptInvite: the claim is what `getActor` reads first, and
  // a removed seat that still claims a business id is a removed seat that can
  // still open the dashboard until the session is rebuilt.
  await repairClaims(userId, nextRoles, null);

  return {
    ok: true,
    name: target.fullName ?? target.email ?? "",
    movedLeads,
    movedTo: options.reassignToId,
  };
}

/** Board 8d §6: once an hour, per invitation, enforced here and not in the UI. */
const RESEND_EVERY_MS = 60 * 60 * 1000;

/** The seven days §6 gives a link. Restated rather than imported to avoid a cycle. */
const INVITE_DAYS = 7;

export type ResendResult = { ok: true } | { ok: false; error: "too_soon" | string };

/**
 * Send an outstanding invitation again, and reset its seven days.
 *
 * The limit is server-side because §6 says so, and because the reason is not
 * politeness: each WhatsApp send is a billed conversation, and a resend button
 * with only a disabled state is a limit that a second tab walks straight past.
 *
 * `lastSentAt` rather than `createdAt` — a resend does not create a row, so the
 * creation time stops being the answer the moment this function is used once.
 */
export async function resendInvite(
  actor: Actor,
  businessId: string,
  inviteId: string,
  now: Date = new Date(),
): Promise<ResendResult> {
  assertCanManageTeam(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only resend your own team's invitations." };
  }

  const invite = await prisma.teamInvite.findFirst({
    where: { id: inviteId, businessId, acceptedAt: null, revokedAt: null },
    select: {
      id: true,
      email: true,
      phone: true,
      token: true,
      roles: true,
      lastSentAt: true,
      business: { select: { displayName: true } },
      invitedBy: { select: { fullName: true } },
    },
  });
  if (!invite) return { ok: false, error: "That invitation cannot be found." };

  if (invite.lastSentAt && now.getTime() - invite.lastSentAt.getTime() < RESEND_EVERY_MS) {
    return { ok: false, error: "too_soon" };
  }

  /*
     The same token, and a fresh expiry.

     `inviteSeat` mints a new token when it is called again, which is right for
     a re-invitation with different roles and wrong here: the seller has already
     sent this person a link, and a resend that silently kills the first one
     turns "I forwarded it to him" into a dead link.
  */
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000);
  await prisma.teamInvite.update({
    where: { id: invite.id },
    data: { expiresAt, lastSentAt: now },
  });

  await sendInvite({
    ...(invite.email ? { email: invite.email } : { phone: invite.phone as string }),
    channel: invite.phone ? "whatsapp" : "email",
    token: invite.token,
    businessName: invite.business.displayName,
    inviterName: invite.invitedBy.fullName ?? invite.business.displayName,
    roles: invite.roles,
    expiresAt,
  });

  return { ok: true };
}
