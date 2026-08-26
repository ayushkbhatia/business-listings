import { LogoTile } from "@/components/display";
import { formatPhone } from "@/lib/format";
import { picks, type SectionProps } from "@/lib/storefront/render-data";
import { t } from "@/lib/i18n";

/**
 * Section 11 — meet the team.
 *
 * The spec asks for "names, roles, numbers", which is a personal phone number
 * on a public page in the same handoff that builds the PDPL erasure path. It is
 * built on `TeamMember`, where `consentGivenAt` is NOT NULL — so there is no
 * row without consent and therefore no state in which somebody is published
 * without it — and the number defaults to the branch line rather than anybody's
 * mobile.
 *
 * `User.phone` is a sign-in credential and never reaches this component. It is
 * not in `SectionData` at all, which is the strongest form of that guarantee.
 */
export function Team({ data, content }: SectionProps) {
  const chosen = picks(content, "members");
  const members = chosen.length
    ? chosen
        .map((id) => data.team.find((member) => member.id === id))
        .filter((member): member is (typeof data.team)[number] => member !== undefined)
    : data.team;

  if (members.length === 0) return null;

  return (
    <section>
      <h2 className="text-h2 text-brand-ink">{t("section.team.title")}</h2>
      <ul className="mt-3 grid gap-[var(--gutter)] sm:grid-cols-2 lg:grid-cols-3">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-3 rounded-card border border-line bg-card p-3">
            <LogoTile
              name={member.name}
              {...(member.photoUrl ? { src: member.photoUrl } : {})}
            />
            <div className="min-w-0">
              <p className="text-body-sm text-ink">{member.name}</p>
              <p className="text-caption text-muted">{member.role}</p>
              {member.phone && (
                <a
                  href={`tel:${member.phone}`}
                  className="rounded-tag font-mono text-caption text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {formatPhone(member.phone)}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 max-w-prose text-caption text-faint">{t("section.team.consent")}</p>
    </section>
  );
}
