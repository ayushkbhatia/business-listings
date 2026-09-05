import { Panel } from "@/components/structure";
import { holds, MATRIX_ROLES, MATRIX_ROWS } from "@/lib/team/matrix";
import { t } from "@/lib/i18n";

/**
 * Board 7d §2 — what each role can do.
 *
 * A real table with headers in both directions. The board draws it as a grid,
 * and a grid of divs loses the row-and-column association that is the entire
 * content here: "does Sales hold this?" is a question about the intersection,
 * and a screen reader can only answer it if the intersection has both headers.
 *
 * Nothing in this file states a permission. Every tick comes from
 * `lib/auth/capabilities.ts`, which is `docs/permissions.md` §2 transcribed and
 * is what `can()` reads on every request. See lib/team/matrix.ts for why that
 * matters more here than anywhere else the matrix is rendered.
 */
export function CapabilityMatrix() {
  return (
    <Panel title={t("team.matrix_heading")} description={t("team.matrix_note")} padded={false}>
      <div className="overflow-x-auto contain-paint">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <caption className="sr-only">{t("team.matrix_caption")}</caption>
          <thead>
            <tr className="bg-paper-sunk">
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                {t("team.col.capability")}
              </th>
              {MATRIX_ROLES.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className="w-20 px-3 py-2 text-caption font-normal text-muted"
                >
                  {t(`team.role.${role}` as "team.role.seller_owner")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX_ROWS.map((row) => (
              <tr key={row.key} className="border-t border-line">
                <th scope="row" className="px-3 py-2 text-left text-body-sm font-normal text-ink">
                  {t(`team.can.${row.key}` as "team.can.respond")}
                  {/*
                    A role grant is not the whole answer on these rows —
                    `lib/auth/subject.ts` completes them — and a bare tick would
                    promise a sales seat every enquiry rather than their own
                    branch's.
                  */}
                  {row.scoped && (
                    <span className="ml-1.5 font-mono text-eyebrow uppercase text-faint">
                      {t("team.scoped_marker")}
                    </span>
                  )}
                </th>
                {MATRIX_ROLES.map((role) => {
                  const yes = holds(role, row.capability);
                  return (
                    <td key={role} className="px-3 py-2 text-body-sm">
                      {/*
                        The glyph is decorative and the word is the content. A
                        column of "✓" read aloud as "check mark" against a dash
                        read as nothing at all is a table with no answers in it.
                      */}
                      <span aria-hidden="true" className={yes ? "text-ink" : "text-faint"}>
                        {yes ? "✓" : "—"}
                      </span>
                      <span className="sr-only">
                        {yes ? t("team.holds") : t("team.holds_not")}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-1 border-t border-line px-3 py-2.5">
        <p className="max-w-prose text-caption text-muted">{t("team.scoped_note")}</p>
        <p className="max-w-prose text-caption text-muted">{t("team.matrix_source")}</p>
      </div>
    </Panel>
  );
}
