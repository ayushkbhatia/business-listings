import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { TEMPLATES } from "../../prisma/seed-notification-templates.mjs";
import { draftProblems } from "@/lib/notify/draft";
import { EVENT_PARAMS, forbiddenPlaceholders, sampleParams } from "@/lib/notify/params";
import { render } from "@/lib/notify/render";
import type { NotificationChannel, NotificationEvent } from "@/lib/db/generated/enums";

/**
 * The template catalogue: what the seed writes, and what the board 12g
 * backfill migration wrote to production.
 *
 * Acceptance criterion 8 first — no notification of any kind contains buyer
 * contact details. A template is written once, reviewed once, and then sends
 * ten thousand times, so the catalogue is read directly rather than trusted.
 *
 * This used to parse `seed.mts` with a regular expression that read only the
 * first chunk of a concatenated body. The list is a module now, so the test
 * imports it and sees every character.
 */

const ORIGIN = "https://businesslistings.me";
const all = TEMPLATES.flatMap((template) => [template.body, template.subject ?? ""]).filter(Boolean);

describe("acceptance criterion 8 — no template leaks buyer contact details", () => {
  it("has templates to check", () => {
    expect(TEMPLATES.length).toBeGreaterThan(10);
  });

  it("names no placeholder that could carry contact details or a quote count (board 12g B3)", () => {
    for (const template of TEMPLATES) {
      expect(
        forbiddenPlaceholders(template.body, template.subject, template.actionLabel, template.actionPath),
        template.body,
      ).toEqual([]);
    }
  });

  it("contains no literal phone number, email address or IBAN", () => {
    for (const text of all) {
      expect(text, text).not.toMatch(/\+?\d[\d\s-]{7,}/);
      expect(text, text).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
      expect(text, text).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,}\b/);
    }
  });
});

describe("the catalogue is sendable", () => {
  it("passes the checks the editor and the save run — every placeholder supplied, every limit kept", () => {
    for (const template of TEMPLATES) {
      const problems = draftProblems(
        {
          event: template.event as NotificationEvent,
          channel: template.channel as NotificationChannel,
          subject: template.subject ?? null,
          body: template.body,
          actionLabel: template.actionLabel ?? null,
          actionPath: template.actionPath ?? null,
          metaTemplateName: template.metaTemplateName ?? null,
        },
        ORIGIN,
      );
      // `weekly_digest` is declared, seeded and sent by nothing, so its event supplies no params.
      const expected = EVENT_PARAMS[template.event as NotificationEvent].length === 0 ? ["unknown_placeholder"] : [];
      expect(problems.map((p) => p.error), `${template.event} on ${template.channel}`).toEqual(expected);
    }
  });

  it("renders every emitted template with sample values, and never throws", () => {
    for (const template of TEMPLATES) {
      const event = template.event as NotificationEvent;
      if (EVENT_PARAMS[event].length === 0) continue;
      expect(() => render(template, sampleParams(event, ORIGIN)), `${event} on ${template.channel}`).not.toThrow();
    }
  });

  it("says what happened and gives one action", () => {
    // A notification with no action trains people to ignore the channel.
    for (const template of TEMPLATES) expect(template.actionPath, template.body).toBeTruthy();
  });

  it("covers all four channels", () => {
    expect(new Set(TEMPLATES.map((t) => t.channel))).toEqual(new Set(["whatsapp", "sms", "email", "in_app"]));
  });

  it("marks every WhatsApp template as awaiting Meta rather than live", () => {
    // A WhatsApp template cannot send until Meta approves it. Writing one live
    // would have the send layer believe in a template the carrier does not have.
    for (const template of TEMPLATES.filter((t) => t.channel === "whatsapp")) {
      expect(template.status, template.body).toBe("pending_meta");
      expect(template.metaTemplateName, template.body).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("holds one version 1 per event, channel and kind — the unique key the backfill and the seed share", () => {
    const keys = TEMPLATES.map((t) => `${t.event}.${t.channel}.${t.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the backfill migration mirrors the catalogue", () => {
  /*
     Production never ran the seed, which is how it came to hold 15 templates
     against 27. `20261027091000_notification_template_backfill` wrote the
     catalogue there; this holds the two in step, so a template added to the
     catalogue without its row in SQL fails here rather than drifting again.

     The migration is frozen once applied — Prisma checksums it — so a template
     added after it needs a new migration, and this test is where that is
     noticed. It compares every field the SQL writes.
  */
  /*
     Every backfill file, not only the first one.

     The original is frozen — Prisma checksums an applied migration — so a
     template added to the catalogue after it needs a migration of its own, and
     this test is where that is noticed. Reading the directory rather than a
     list means the next one is covered by existing, rather than by somebody
     remembering to add a path here. Board 4h's `report_resolved` pair is the
     first to arrive this way.
  */
  const sql = readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      try {
        return readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8");
      } catch {
        return "";
      }
    })
    // Selected by what the file does, not by what it is called.
    .filter((text) => text.includes('INSERT INTO "notification_template"'))
    .join("\n");
  const quote = (value: string | undefined) => (value === undefined ? "NULL" : `'${value.replace(/'/g, "''")}'`);

  for (const template of TEMPLATES) {
    it(`carries ${template.event} on ${template.channel}`, () => {
      const row =
        `(${quote(template.event)}, ${quote(template.channel)}, ${quote(template.kind)}, ${quote(template.status ?? "live")}, ${quote(template.subject)},\n` +
        `   ${quote(template.body)},\n` +
        `   ${quote(template.actionLabel)}, ${quote(template.actionPath)}, ${quote(template.metaTemplateName)})`;
      expect(sql.includes(row), `the backfill has no row matching:\n${row}`).toBe(true);
    });
  }

  it("carries nothing the catalogue does not", () => {
    const rows = sql.match(/^\s+\('[a-z_]+', '(whatsapp|email|sms|in_app)',/gm) ?? [];
    expect(rows.length).toBe(TEMPLATES.length);
  });
});
