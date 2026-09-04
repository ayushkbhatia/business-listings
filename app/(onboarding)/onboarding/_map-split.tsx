/**
 * Board 2d's frame, in its own file rather than in `_chrome.tsx`.
 *
 * `_chrome.tsx` imports `STEPS` from `lib/onboarding/service`, which is
 * `server-only`. That is correct there — the header is a server component — but
 * it makes the whole module unimportable from a client one: the boundary erases
 * types and keeps values, so `import { OnboardingMapSplit } from "./_chrome"`
 * pulls the service in, and with it `pg`, and the build fails on a wall of
 * unresolved `net` / `dns` / `fs` that names none of the files involved.
 *
 * This layout has no server dependency at all, so it lives where both sides can
 * reach it. The same trap board 2c hit with `profile-fields.ts`.
 */

/**
 * Not `OnboardingColumn` with a rail. The map is the argument on this step —
 * "drag the pin to your gate, not the street" is an instruction you cannot
 * follow in a 300px box — so it takes the whole right-hand side, edge to edge
 * and floor to ceiling, with no card border of its own. The form keeps a fixed
 * measure on the left and scrolls independently, which is what lets a seller
 * work down six branches without the map leaving the screen.
 *
 * Below `lg` the two stack and the map takes a fixed height. A phone cannot
 * show both at once, and a map squeezed beside a form on a 390px screen is two
 * things that are each too small to use.
 */
export function OnboardingMapSplit({
  children,
  map,
}: {
  children: React.ReactNode;
  map: React.ReactNode;
}) {
  return (
    <main className="flex min-h-0 flex-col lg:h-[calc(100vh-3.75rem)] lg:flex-row lg:overflow-hidden">
      <div className="min-w-0 flex-1 px-[var(--section-pad)] pb-16 pt-8 md:pt-10 lg:max-w-[46rem] lg:overflow-y-auto">
        {children}
      </div>
      <div className="h-[26rem] w-full border-t border-line lg:h-auto lg:w-auto lg:flex-1 lg:border-s lg:border-t-0">
        {map}
      </div>
    </main>
  );
}
