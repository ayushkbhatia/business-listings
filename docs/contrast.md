# Contrast — measured, and where it fails

Design-system §09.2 sets the floor: body text ≥ 4.5:1, large text and UI borders
≥ 3:1. `docs/tokens.css` sets the colours. **Ten pairings in daily use do not
clear the floor**, and this document is the measurement rather than an opinion.

Two commands reproduce everything here:

```bash
pnpm check:contrast     # every pairing the system uses, computed from tokens.css
pnpm report:contrast    # what axe actually finds on the rendered gallery
```

## What axe finds on `/dev/gallery`

611 failing nodes, from thirteen colour pairings, as of the tier 3 display
components. Every other axe rule passes. The pairings are the same two tokens
on more surfaces — no component has introduced a new failing combination.

| nodes | foreground on background | token | measured | floor |
|---:|---|---|---:|---:|
| 214 | `#a29d92` on `#faf9f6` | `--text-faint` on `--paper` | 2.56:1 | 4.5:1 |
| 79 | `#7c776c` on `#faf9f6` | `--text-muted` on `--paper` | 4.23:1 | 4.5:1 |
| 67 | `#7c776c` on `#f6f4ee` | `--text-muted` on `--paper-sunk` | 4.05:1 | 4.5:1 |
| 45 | `#7c776c` on `#ffffff` | `--text-muted` on `--card` | 4.45:1 | 4.5:1 |
| 40 | `#a29d92` on `#ffffff` | `--text-faint` on `--card` | 2.70:1 | 4.5:1 |
| 21 | `#8a857a` on `#211f1b` | `--text-on-ink-faint` on `--ink` | 4.47:1 | 4.5:1 |
| 3 | `#7c776c` on `#f2f0ea` | `--text-muted` on `--fill` | 3.91:1 | 4.5:1 |
| 3 | `#8a6d12` on `#f7efdd` | `--warn-ink` on `--warn-wash` | 4.28:1 | 4.5:1 |
| 2 | `#7c776c` on `#f7f5f0` | `--text-muted` on `--placeholder-empty-b` | 4.09:1 | 4.5:1 |
| 1 | `#7c776c` on `#f4f9f5` | `--text-muted` on `--ok-surface` | 4.18:1 | 4.5:1 |

Two tokens account for almost all of the 611: `--text-faint` and `--text-muted`.
The table above is the checkpoint-6 snapshot; `pnpm report:contrast` prints the
current one.

## The shape of the problem

**`--text-faint` is not a text colour.** At 2.56:1 on paper it does not clear the
4.5:1 body floor, the 3:1 large-text floor, or even the 3:1 non-text floor. The
token comment scopes it to "labels, placeholders — 11.5px+ on paper only", but
11.5px is not large text under WCAG (that starts at 18.66px, or 14pt bold), so
the exemption the comment implies does not exist. It is used for mono eyebrows,
column-head accents, placeholders and disabled hints.

**`--text-muted` is a near miss everywhere.** 4.05 to 4.45 against a 4.5 floor.
Nudging it two or three steps darker clears every one of its six pairings at
once and would be invisible next to the current value.

**`--text-on-ink-faint` and `--warn-ink` are also near misses** — 4.47 and 4.28.

Non-text pairings sit outside axe's remit but are worth stating: `--line-strong`
as an input border is 1.64:1 on card, against a 3:1 floor for identifying a UI
component. `pnpm check:contrast` covers those.

## What was not done, and why

`tokens.css` is the file the handoff says to paste unchanged, and these values
come from the canvas. Changing them here would put the build and the design out
of sync silently, which is worse than a documented gap. So:

- no token value has been altered
- the failures are enumerated, reproducible, and counted
- the Playwright suite pins the count at 611, so a *new* contrast failure
  introduced by a component still breaks the build

## Three ways out, for the design decision

1. **Darken two tokens.** `--text-muted` to roughly `#6E6A60` and
   `--text-faint` to roughly `#6F6A60` clears all ten pairings. It costs the
   quietness of the current ramp, which is a real part of how the system looks.
2. **Keep the colours, narrow their use.** Restrict `--text-faint` to
   genuinely decorative marks that repeat information available elsewhere, and
   promote every label, placeholder and eyebrow to `--text-muted` — then darken
   `--text-muted` alone, which is a two-step change nobody will see.
3. **Accept the gap and record it.** Defensible only if the product is not
   claiming WCAG AA. It is not a position to arrive at by accident, which is
   why it is written down here rather than left as a passing test.

Option 2 is the smallest change that clears the floor, and the one worth
putting to whoever owns the canvas.

## One thing that was fixed

A real defect, not a token question. `tokens.css` was pasted at the top level of
`globals.css`, outside any cascade layer. Tailwind v4 puts its utilities *in* a
layer, and unlayered CSS beats every layer regardless of specificity — so
`a { color: var(--moss) }` from the token block silently overrode
`text-on-ink-muted` on every link in the ink sidebar. Base moss rendered on ink
at **2.15:1**, the one pairing design-system §01 explicitly forbids: "base moss
fails contrast there". axe found 46 such nodes.

The block is now wrapped in `@layer base`, byte-identical inside. That is the
only edit, and it removed 46 of the original 521 failures.
