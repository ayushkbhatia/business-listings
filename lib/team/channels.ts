import "server-only";
import { createHash, randomInt } from "node:crypto";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import type { SeatChannelKind } from "@/lib/db/generated/client";
import { checkThrottle, recordAttempt } from "@/lib/auth/attempts";
import { resolveOtpSender } from "@/lib/auth/otp";
import { resolveNotificationSenders } from "@/lib/notify/senders";
import { recordEvent } from "@/lib/telemetry/record";
import { t } from "@/lib/i18n";
import { readContact } from "./contact";

/**
 * Board 7e §8.1 — proving a channel.
 *
 * "An unverified number is hidden from buyers **and receives nothing**." Board
 * 8d collects the first channel at sign-in; this is the management surface, and
 * without it the amber row on board 7d would be a dead end — a seat told it is
 * not a routing target, with nothing on any screen that would make it one.
 *
 * ## Whose channels
 *
 * Your own, and nobody else's. 7d §6.1: "not show one seat's numbers to another
 * seat." An owner sees which *kinds* a colleague has proven — that is the
 * reachability rail, and it is what they need to fix a team that cannot be
 * reached — and never the address, and never a control over it. So every
 * function here acts on `actor.id`, and there is no parameter to point it
 * elsewhere. A capability check would be the wrong shape: this is not a
 * permission that a senior role holds more of.
 *
 * ## Two throttles, two different reasons
 *
 * `lib/auth/throttle.ts` already distinguishes them and this reuses it rather
 * than inventing a third policy. Asking for a code is cheap to the person and
 * costs us a billed WhatsApp conversation; getting one wrong is free to us and
 * is the only thing between six digits and somebody else's notifications.
 *
 * On top of that, `SeatChannelChallenge.attempts` counts wrong guesses against
 * one code, so asking for a new code is a fresh five rather than an escape from
 * the last five.
 */

/** What a seat can actually prove today. */
export const ADDABLE_KINDS: readonly SeatChannelKind[] = ["whatsapp", "email"];

/** Six digits, ten minutes. The same shape as the sign-in code, deliberately. */
const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60_000;
/** Wrong guesses against one code before it is burned. */
const MAX_ATTEMPTS = 5;

export interface SeatChannelRow {
  kind: SeatChannelKind;
  /** The seat's own address. Never leaves the seat that owns it. */
  address: string;
  verified: boolean;
  /** True while a code is out and still good. */
  awaitingCode: boolean;
}

export type ChannelResult =
  | { ok: true; sent: boolean }
  | { ok: false; error: string; retryAfterMs?: number };

export type VerifyResult = { ok: true } | { ok: false; error: string };

/** This seat's own channels, in the order routing would try them. */
export async function channelsFor(actor: Actor, now = new Date()): Promise<SeatChannelRow[]> {
  const rows = await prisma.seatChannel.findMany({
    where: { userId: actor.id },
    select: {
      kind: true,
      address: true,
      verifiedAt: true,
      challenge: { select: { expiresAt: true, attempts: true } },
    },
  });

  const order: SeatChannelKind[] = ["whatsapp", "sms", "email"];
  return rows
    .map((row) => ({
      kind: row.kind,
      address: row.address,
      verified: row.verifiedAt !== null,
      awaitingCode:
        row.verifiedAt === null &&
        row.challenge !== null &&
        row.challenge.expiresAt.getTime() > now.getTime() &&
        row.challenge.attempts < MAX_ATTEMPTS,
    }))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/**
 * Add a channel, or send a fresh code for one already entered.
 *
 * One function for both, because they are the same act from the seat's side —
 * "send me a code for this address" — and splitting them would leave the screen
 * deciding which to call from a state it read a moment ago.
 *
 * The address is re-read every time. A seat correcting a typo is the common case,
 * and an add that refused to change the address would leave them with a row they
 * could neither prove nor edit.
 */
export async function startVerification(
  actor: Actor,
  input: { kind: SeatChannelKind; address: string },
  now = new Date(),
): Promise<ChannelResult> {
  if (!actor.businessId) return { ok: false, error: t("channels.no_seat") };
  if (!ADDABLE_KINDS.includes(input.kind)) return { ok: false, error: t("channels.kind_unavailable") };

  /*
     Sniffed and normalised by the same function the invite box uses, so an
     address stored here has the same shape as one stored there — E.164 for a
     number, lowercase for an address. Two normalisations would be two answers
     to "is this the same channel", and the unique index is on (seat, kind).
  */
  const contact = readContact(input.address);
  if (!contact.ok) return { ok: false, error: t("channels.unreadable") };
  if (input.kind === "email" && contact.channel !== "email") {
    return { ok: false, error: t("channels.expected_email") };
  }
  if (input.kind !== "email" && contact.channel !== "whatsapp") {
    return { ok: false, error: t("channels.expected_mobile") };
  }
  const address = contact.email ?? (contact.phone as string);

  const gate = await checkThrottle(address, "otp_request", now);
  if (!gate.allowed) {
    return {
      ok: false,
      error: t("channels.too_soon"),
      retryAfterMs: gate.retryAfterMs,
    };
  }

  const channel = await prisma.seatChannel.upsert({
    where: { userId_kind: { userId: actor.id, kind: input.kind } },
    create: {
      userId: actor.id,
      businessId: actor.businessId,
      kind: input.kind,
      address,
      challengeSentAt: now,
    },
    /*
       An address that changed is a different channel, so the proof does not
       carry over. Without this, a seat could prove one number and then edit the
       row to another — which is precisely the lie the whole rule exists to stop.
    */
    update: { address, challengeSentAt: now, verifiedAt: null },
    select: { id: true },
  });

  const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
  await prisma.seatChannelChallenge.upsert({
    where: { seatChannelId: channel.id },
    create: {
      seatChannelId: channel.id,
      codeHash: hash(code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
    // Replaced, never stacked: the code in the most recent message is the only
    // one that works, and the attempt counter starts again with it.
    update: {
      codeHash: hash(code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      attempts: 0,
    },
  });

  const sent = await send(input.kind, address, code);
  await recordAttempt({ identifier: address, kind: "otp_request", succeeded: sent, ip: null });

  /*
     `ok` whether or not the carrier took it. The challenge exists either way and
     the screen says which happened — a seat whose WhatsApp template is still
     waiting on Meta needs to know that rather than see a generic failure and
     try again five times.
  */
  return { ok: true, sent };
}

/** Prove it. The write that turns an amber row green on both screens. */
export async function confirmVerification(
  actor: Actor,
  input: { kind: SeatChannelKind; code: string },
  now = new Date(),
): Promise<VerifyResult> {
  const channel = await prisma.seatChannel.findUnique({
    where: { userId_kind: { userId: actor.id, kind: input.kind } },
    select: {
      id: true,
      address: true,
      businessId: true,
      verifiedAt: true,
      challenge: { select: { codeHash: true, expiresAt: true, attempts: true } },
    },
  });
  if (!channel) return { ok: false, error: t("channels.not_found") };
  if (channel.verifiedAt) return { ok: true };
  if (!channel.challenge) return { ok: false, error: t("channels.no_code") };

  const gate = await checkThrottle(channel.address, "otp_verify", now);
  if (!gate.allowed) return { ok: false, error: t("channels.too_many") };

  const fail = async (reason: string): Promise<VerifyResult> => {
    await recordAttempt({
      identifier: channel.address,
      kind: "otp_verify",
      succeeded: false,
      ip: null,
    });
    await prisma.seatChannelChallenge.update({
      where: { seatChannelId: channel.id },
      data: { attempts: { increment: 1 } },
    });
    await recordEvent({
      name: "channel_verification_failed",
      businessId: channel.businessId,
      props: { channel: input.kind, reason },
    });
    return {
      ok: false,
      error: reason === "expired" ? t("channels.expired") : t("channels.wrong_code"),
    };
  };

  if (channel.challenge.expiresAt.getTime() <= now.getTime()) return fail("expired");
  if (channel.challenge.attempts >= MAX_ATTEMPTS) return fail("burned");
  if (hash(input.code.trim()) !== channel.challenge.codeHash) return fail("wrong_code");

  await prisma.$transaction([
    prisma.seatChannel.update({
      where: { id: channel.id },
      data: { verifiedAt: now },
    }),
    // The challenge is spent. A row left behind would let the same six digits
    // work again if the seat were ever un-verified.
    prisma.seatChannelChallenge.delete({ where: { seatChannelId: channel.id } }),
  ]);

  await recordAttempt({
    identifier: channel.address,
    kind: "otp_verify",
    succeeded: true,
    ip: null,
  });
  await recordEvent({
    name: "channel_verified",
    businessId: channel.businessId,
    props: { channel: input.kind },
  });

  return { ok: true };
}

/**
 * Take a channel off this seat.
 *
 * Not guarded on "you must keep one". A seat that removes its last channel has
 * made itself unroutable, which is a state both screens render in amber and
 * which the seller can see and undo — and the alternative is a screen that
 * refuses to remove a number somebody no longer has.
 */
export async function removeChannel(
  actor: Actor,
  kind: SeatChannelKind,
): Promise<VerifyResult> {
  const { count } = await prisma.seatChannel.deleteMany({
    where: { userId: actor.id, kind },
  });
  if (count === 0) return { ok: false, error: t("channels.not_found") };
  return { ok: true };
}

function hash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Carry six digits.
 *
 * WhatsApp goes through the OTP sender rather than the notification one: it is
 * the only path with a Meta-approved authentication template, and a
 * notification-shaped WhatsApp message carrying a code would be rejected by
 * Meta rather than delivered. Everything else goes through the notification
 * senders, which is where email lives.
 *
 * Never throws. A carrier being down leaves the seat with a challenge it can ask
 * for again, which is better than an exception on a settings screen.
 */
async function send(kind: SeatChannelKind, to: string, code: string): Promise<boolean> {
  try {
    if (kind === "whatsapp") {
      const sender = resolveOtpSender();
      const result = await sender.send({ to, code, expiresInMinutes: CODE_TTL_MS / 60_000 });
      return result.delivered;
    }

    const sender = resolveNotificationSenders()[kind];
    if (!sender) return false;
    const result = await sender.send({
      channel: kind,
      to,
      subject: t("channels.code_subject"),
      body: t("channels.code_body", { code, minutes: String(CODE_TTL_MS / 60_000) }),
      actionLabel: null,
      actionUrl: null,
      recipientUserId: null,
    });
    return result.delivered;
  } catch (cause) {
    console.error("[channels] verification code failed to send", { kind, cause });
    return false;
  }
}
