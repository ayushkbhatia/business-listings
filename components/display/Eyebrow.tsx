import { cn } from "@/lib/cn";

/**
 * The mono uppercase label that sits above a band or beside a row.
 *
 * `BY EMIRATE` on the directory home, `BROWSE ANY TRADE BY EMIRATE — 84 PAGES`
 * on the category index, the column heads in the footer. Design-system §08 says
 * sentence case everywhere *except* mono eyebrows and column heads, which makes
 * this one of exactly two places uppercase is allowed — worth a component, so
 * the exception is spelled once rather than remembered.
 *
 * It was hand-rolled four times before this existed, at three different
 * letter-spacings (.1em, .11em, .12em). Nobody would call that a decision. The
 * tracking now comes from `--ls-eyebrow`, which is what the token is for.
 *
 * `as` matters more than it looks. On the home page the emirate row's eyebrow
 * is the section's heading and has to be an `h2` or the band has no accessible
 * name; in the footer the same treatment labels a `nav` and must not be a
 * heading at all, because three extra headings in the document outline is a bug
 * that already cost this project a failing test.
 */
export interface EyebrowProps {
  children: React.ReactNode;
  /** The element. A heading where it names a section, a span where it labels. */
  as?: "span" | "p" | "h2" | "h3";
  /** On a dark surface. */
  onInk?: boolean;
  id?: string;
  className?: string;
}

export function Eyebrow({
  children,
  as: Tag = "span",
  onInk = false,
  id,
  className,
}: EyebrowProps) {
  return (
    <Tag
      id={id}
      className={cn(
        "font-mono text-eyebrow uppercase",
        // Not --text-faint, which the boards draw these in. That token measures
        // 2.56:1 on paper and design-system §09.2 sets the floor at 4.5:1; see
        // docs/contrast.md, where it is one of ten pairings the project has
        // pinned rather than shipped.
        onInk ? "text-on-ink-muted" : "text-muted",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
