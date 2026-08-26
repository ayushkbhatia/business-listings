import { en } from "./en";
import { LOCALES } from "./locales";

/**
 * What the string catalogue contains — board 12g's localisation surface.
 *
 * ## Why this is a report and not an editor
 *
 * The catalogue is `lib/i18n/en.ts`, a TypeScript module. `t()` is typed
 * against its keys, which is what makes a missing string a build failure rather
 * than a blank space on a page — the guarantee CLAUDE.md asks for when it says
 * every user-visible string goes through `t()`.
 *
 * An editor that wrote strings at runtime would need an override table read by
 * `t()`, and that trade is: staff can fix a typo without a deploy, and in
 * exchange every string becomes nullable, the key type stops being exhaustive,
 * and a row nobody wrote wins over a string somebody reviewed.
 *
 * `docs/routes.md` calls this screen "Localisation", and CLAUDE.md says Arabic
 * is "a later translation project, not a rebuild" — `lib/i18n/locales.ts` puts
 * it plainer still: *"'ar' here must be a data change and a stylesheet review,
 * never a refactor."* A translation project needs to know what it is quoting
 * for. That is what this tells it.
 */

export interface SectionCoverage {
  /** The part before the first dot: `admin`, `storefront`, `enquiry`. */
  prefix: string;
  keys: number;
  /** Keys whose value is a plural object rather than a string. */
  plural: number;
  /** Keys whose copy carries a {placeholder}. */
  interpolated: number;
  words: number;
}

export interface CatalogueCoverage {
  locales: readonly string[];
  keys: number;
  plural: number;
  interpolated: number;
  words: number;
  sections: SectionCoverage[];
  /** The longest single string, which is what a translator quotes on. */
  longest: { key: string; words: number };
}

type Value = string | Record<string, string>;

function stringsOf(value: Value): string[] {
  return typeof value === "string" ? [value] : Object.values(value);
}

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

const INTERPOLATION = /\{[a-zA-Z0-9_]+\}/;

export function catalogueCoverage(): CatalogueCoverage {
  const entries = Object.entries(en) as [string, Value][];
  const sections = new Map<string, SectionCoverage>();

  let plural = 0;
  let interpolated = 0;
  let total = 0;
  let longest = { key: "", words: 0 };

  for (const [key, value] of entries) {
    const prefix = key.split(".")[0] ?? key;
    const section = sections.get(prefix) ?? {
      prefix,
      keys: 0,
      plural: 0,
      interpolated: 0,
      words: 0,
    };

    const isPlural = typeof value !== "string";
    const parts = stringsOf(value);
    const count = parts.reduce((sum, part) => sum + words(part), 0);
    const hasPlaceholder = parts.some((part) => INTERPOLATION.test(part));

    section.keys += 1;
    if (isPlural) section.plural += 1;
    if (hasPlaceholder) section.interpolated += 1;
    section.words += count;
    sections.set(prefix, section);

    if (isPlural) plural += 1;
    if (hasPlaceholder) interpolated += 1;
    total += count;

    /*
     * The longest string, because it is what a translator quotes on and what a
     * layout breaks on. German and Arabic both run longer than English.
     */
    const longestPart = Math.max(...parts.map(words));
    if (longestPart > longest.words) longest = { key, words: longestPart };
  }

  return {
    locales: LOCALES,
    keys: entries.length,
    plural,
    interpolated,
    words: total,
    sections: [...sections.values()].sort((a, b) => b.keys - a.keys),
    longest,
  };
}

export interface StringEntry {
  key: string;
  /** Joined for display where the value is a plural object. */
  text: string;
  plural: boolean;
  interpolated: boolean;
}

/** Every string, for the browser. Filtered in the screen, not here. */
export function catalogueEntries(): StringEntry[] {
  return (Object.entries(en) as [string, Value][]).map(([key, value]) => {
    const parts = stringsOf(value);
    return {
      key,
      text: typeof value === "string" ? value : parts.join("  ·  "),
      plural: typeof value !== "string",
      interpolated: parts.some((part) => INTERPOLATION.test(part)),
    };
  });
}
