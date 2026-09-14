import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Board 12d — call history for three accounts the call list will derive.
 *
 * The seed writes no task: tasks are the derivation's alone, and a seed that
 * inserted them would be the manual add the board forbids. What it writes is
 * the call log a working week leaves behind, on businesses whose signals the
 * rest of the seed already produces — so when the list is built, from the
 * nightly job or *Refresh signals*, each row starts where its conversation left
 * off, the way `resumeFrom` resumes any business.
 *
 *   - Sharjah Steel Fabricators (board 4f, a product cap refusal): interested,
 *     yesterday — a follow-up.
 *   - Al Bariq Trading (an unverified listing in the held Al Quoz Industrial 3
 *     HVAC page): asked to be called back in three days — a call-back not due.
 *   - Al Manara Equipment Trading (Free, enquiries missed at its cap): no
 *     answer four days ago — a touch whose cooling period has passed.
 *
 * Runs after the staff roster and the revenue fixtures it names. Skips anything
 * it cannot find rather than inventing a row for it.
 */

type Db = PrismaClient;

const DAY = 86_400_000;

export async function seedCrmCalls(db: Db, now: Date): Promise<void> {
  console.log("→ call history, for board 12d");

  const staff = await db.user.findFirst({
    where: { roles: { has: "staff_ops_lead" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!staff) {
    console.log("   skipped — no ops lead in this seed");
    return;
  }

  const calls = [
    { slug: "sharjah-steel-fabricators", kind: "interested", signal: "cap_reached", ago: 1, note: "Wants to see what Pro lists before deciding. Asked for the plan page." },
    { slug: "al-bariq-trading-llc", kind: "call_back", signal: "held_page", ago: 3, note: "Owner on site all week. Call back Thursday morning.", callBackIn: 3 },
    { slug: "al-manara-equipment-trading-llc", kind: "no_answer", signal: "cap_reached", ago: 4, note: null },
  ] as const;

  let written = 0;
  for (const call of calls) {
    const business = await db.business.findUnique({ where: { slug: call.slug }, select: { id: true } });
    if (!business) continue;
    await db.callOutcome.create({
      data: {
        businessId: business.id,
        staffId: staff.id,
        kind: call.kind,
        signal: call.signal,
        note: call.note,
        callBackAt: "callBackIn" in call ? new Date(now.getTime() + call.callBackIn * DAY) : null,
        createdAt: new Date(now.getTime() - call.ago * DAY),
      },
    });
    written += 1;
  }
  console.log(`   ${written} calls logged`);
}
