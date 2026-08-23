import { en, type MessageKey } from "./en";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import type { Catalogue, Message, Params, PluralForms } from "./types";

const CATALOGUES: Record<Locale, Catalogue> = { en };

const PLACEHOLDER = /\{(\w+)\}/g;

/** Loud in development and in tests, quiet in production. A missing string is a
 * bug, but it is never worth a white screen in front of a buyer. */
function report(message: string): void {
  if (process.env.NODE_ENV === "production") {
    console.warn(`[i18n] ${message}`);
    return;
  }
  throw new Error(`[i18n] ${message}`);
}

function selectPlural(forms: PluralForms, count: number, locale: Locale): string {
  const category = new Intl.PluralRules(locale).select(count);
  return forms[category] ?? forms.other;
}

function interpolate(template: string, params: Params | undefined, key: string): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params?.[name];
    if (value === undefined) {
      report(`Missing parameter "${name}" for key "${key}"`);
      return whole;
    }
    return String(value);
  });
}

export interface TranslateOptions {
  locale?: Locale;
}

/**
 * Every user-visible string goes through here.
 *
 * Keys are typed against the English catalogue, so a typo is a build error and
 * a deleted string breaks the build rather than shipping a blank label.
 *
 *   t("action.save")
 *   t("count.suppliers_in_area", { count: 218, area: "Al Quoz" })
 */
export function t(
  key: MessageKey,
  params?: Params,
  { locale = DEFAULT_LOCALE }: TranslateOptions = {},
): string {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
  let message: Message | undefined = catalogue[key];

  if (message === undefined && locale !== DEFAULT_LOCALE) {
    message = CATALOGUES[DEFAULT_LOCALE][key];
  }

  if (message === undefined) {
    report(`Unknown key "${key}"`);
    return key;
  }

  if (typeof message === "string") return interpolate(message, params, key);

  const count = params?.count;
  if (typeof count !== "number") {
    report(`Key "${key}" is pluralised and needs a numeric "count" parameter`);
    return interpolate(message.other, params, key);
  }

  return interpolate(selectPlural(message, count, locale), params, key);
}

/** True when the key exists. For a staff tool that lists untranslated strings. */
export function hasMessage(key: string, locale: Locale = DEFAULT_LOCALE): boolean {
  return Object.hasOwn(CATALOGUES[locale] ?? {}, key);
}

/** Every key in the catalogue. The localisation admin screen reads this. */
export function messageKeys(): MessageKey[] {
  return Object.keys(en) as MessageKey[];
}
