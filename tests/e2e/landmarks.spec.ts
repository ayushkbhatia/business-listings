import { expect, test } from "@playwright/test";

/**
 * Landmarks have to be uniquely named or a screen reader's landmark list is a
 * row of identical entries. On the gallery this bites hard: it renders four
 * sidebars and two public navs on one page, which no product page ever does.
 */
test("no two landmarks share a role and a name", async ({ page }) => {
  await page.goto("/dev/gallery");

  const duplicates = await page.evaluate(() => {
    // A <header> or <footer> is only a landmark when it is not nested inside
    // article, aside, main, nav or section. Nested ones are just headers.
    const selector = [
      "main", "nav", "aside", "form",
      "section[aria-label]", "section[aria-labelledby]",
      "[role=navigation]", "[role=banner]", "[role=main]",
      "[role=contentinfo]", "[role=complementary]", "[role=region]",
    ].join(", ");
    const NESTING = "article, aside, main, nav, section";

    const name = (el: Element) =>
      el.getAttribute("aria-label") ||
      (el.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ")
        .trim() ||
      "(unnamed)";

    const counts: Record<string, number> = {};
    const elements = [
      ...document.querySelectorAll(selector),
      ...[...document.querySelectorAll("header, footer")].filter(
        (el) => !el.parentElement?.closest(NESTING),
      ),
    ];
    for (const el of elements) {
      const role = el.getAttribute("role") ?? el.tagName.toLowerCase();
      const key = `${role} :: ${name(el)}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).filter(([, n]) => n > 1);
  });

  expect(duplicates, JSON.stringify(duplicates, null, 2)).toEqual([]);
});
