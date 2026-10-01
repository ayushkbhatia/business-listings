/**
 * Board 4c `B10` — what a listing's claim status says in public.
 *
 * Only `claimed` renders as a claimed listing. `disputed` is two claims and no
 * decision, and while it lasts the listing renders **exactly as unclaimed**:
 * neither claimant's name, badge, number or composer appears until somebody
 * has decided which of them it belongs to (`10g`, `12a`'s *not verified by
 * us*). Every public surface asks this one question rather than comparing
 * against `unclaimed`, which is how `disputed` used to slip through to the
 * claimed composition with an owner nobody had approved.
 */
export function publiclyClaimed(claimStatus: string): boolean {
  return claimStatus === "claimed";
}
