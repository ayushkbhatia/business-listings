import { describe, expect, it } from "vitest";
import { resolveRobots } from "next/dist/build/webpack/loaders/metadata/resolve-route-data.js";
import robots from "@/app/robots";

/**
 * Assert on the rendered document, not on the object.
 *
 * The object is easy to get right and easy to get wrong in a way that only
 * shows up in the text: a group that inherits nothing, an `Allow` shorter than
 * the `Disallow` it is meant to beat, a directive Next drops silently. This
 * renders it through Next's own resolver — the same function the build calls —
 * so what the test reads is what a crawler would read.
 */
function render(): string {
  return resolveRobots(robots());
}

/** The lines of one `User-Agent` group, keyed by the first agent named in it. */
function groups(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let key: string | null = null;
  let agentsOpen = false;
  for (const line of text.split("\n")) {
    const [field, ...rest] = line.split(":");
    const name = field?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (name === "user-agent") {
      if (!agentsOpen) {
        key = value;
        out.set(key, []);
        agentsOpen = true;
      }
      out.get(key!)!.push(`User-Agent: ${value}`);
      continue;
    }
    if (line.trim() === "") {
      agentsOpen = false;
      continue;
    }
    if (key && name) {
      agentsOpen = false;
      out.get(key)!.push(line.trim());
    }
  }
  return out;
}

describe("robots.txt", () => {
  it("takes the facet query space out of the crawl for everyone", () => {
    const text = render();
    expect(text).toContain("Disallow: /c/*?");
    expect(text).toContain("Disallow: /b/*?");
  });

  it("keeps pagination crawlable, on a longer rule than the one blocking it", () => {
    // The rule that stops this fix from cutting the directory in half. Every
    // supplier past the twentieth in a trade is reachable only through it.
    const text = render();
    expect(text).toContain("Allow: /c/*?page=");
    expect(text).toContain("Allow: /b/*?page=");
    expect("/c/*?page=".length).toBeGreaterThan("/c/*?".length);
  });

  it("denies the training crawlers outright", () => {
    // ClaudeBot is named because it is the agent in the 2026-09-04 log: 794
    // requests to one shelf in 75 minutes, no buyer sent.
    const claude = groups(render()).get("ClaudeBot");
    expect(claude).toBeDefined();
    expect(claude).toContain("Disallow: /");
    expect(claude).toContain("User-Agent: GPTBot");
    expect(claude).toContain("User-Agent: meta-externalagent");
  });

  it("does not deny the assistant fetchers that send buyers", () => {
    // The distinction the policy turns on, asserted on the rendered text so
    // that adding one of these to the wrong constant fails here.
    const text = render();
    for (const agent of ["Claude-User", "ChatGPT-User", "PerplexityBot", "OAI-SearchBot"]) {
      expect(text).not.toContain(`User-Agent: ${agent}`);
    }
  });

  it("repeats the whole rule set in the crawl-delay group rather than inheriting", () => {
    /*
       A crawler obeys the single most specific group that matches it and
       ignores `*` entirely once one does. A group carrying only `Crawl-delay`
       would have re-opened the facet space to exactly the agents it was meant
       to slow down — the failure this test exists for.
    */
    const ahrefs = groups(render()).get("AhrefsBot");
    expect(ahrefs).toBeDefined();
    expect(ahrefs).toContain("Disallow: /c/*?");
    expect(ahrefs).toContain("Allow: /c/*?page=");
    expect(ahrefs).toContain("Crawl-delay: 10");
  });

  it("still keeps the four original surfaces out of the index", () => {
    const text = render();
    for (const path of ["/search", "/compare", "/dev", "/admin", "/staff"]) {
      expect(text).toContain(`Disallow: ${path}`);
    }
  });

  it("names a host and a sitemap", () => {
    const text = render();
    expect(text).toMatch(/^Host: https?:\/\/\S+$/m);
    expect(text).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
  });
});
