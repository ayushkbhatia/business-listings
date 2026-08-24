"use client";

import { Button, IconButton, SearchField } from "@/components/primitives";
import { Close, Dots } from "@/components/primitives/icons";
import {
  AdminShell,
  ADMIN_NAV,
  AppSidebar,
  Breadcrumb,
  BuilderChrome,
  Card,
  DASHBOARD_NAV,
  DashboardShell,
  PageHeader,
  Panel,
  PublicNav,
  PublicShell,
  Tabs,
} from "@/components/structure";
import type { Actor } from "@/lib/auth/roles";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

/** The shells are viewport-sized. Framed here so they fit a review page. */
function Viewport({ children, height = 460 }: { children: React.ReactNode; height?: number }) {
  return (
    <div
      className="w-full overflow-hidden rounded-card border border-line-strong"
      style={{ height }}
    >
      <div className="h-full overflow-auto">{children}</div>
    </div>
  );
}

const SELLER: Actor = { id: "u1", roles: ["seller_owner"], businessId: "b1" };
const SALES: Actor = { id: "u2", roles: ["seller_sales"], businessId: "b1" };
const MODERATOR: Actor = { id: "u3", roles: ["staff_moderator"] };
const OPS: Actor = { id: "u4", roles: ["staff_ops_lead"] };

export function Shells() {
  return (
    <>
      <Section id="public-nav" title="PublicNav" note="68px, and the search field lives in the bar">
        <States label="states" stack>
          <div className="w-full overflow-hidden rounded-card border border-line">
            <PublicNav
              label={`${t("nav.label.public")} — standalone`}
              brand="Business Listings"
              search={
                <SearchField
                  label={t("search.label")}
                  clearLabel={t("search.clear")}
                  placeholder={t("search.placeholder")}
                />
              }
              links={[
                { key: "categories", label: "Categories", href: "#" },
                { key: "guides", label: "Guides", href: "#" },
                { key: "pricing", label: "Pricing", href: "#" },
              ]}
              actions={
                <>
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                  <Button size="sm">{t("gallery.list_your_business")}</Button>
                </>
              }
            />
          </div>
        </States>
      </Section>

      <Section
        id="app-sidebar"
        title="AppSidebar"
        note="one component, two configs — an item the actor cannot reach is locked, not hidden"
      >
        <States label="seller_owner vs seller_sales" stack>
          <div className="flex gap-4">
            <Viewport height={420}>
              <AppSidebar
                label={`${t("nav.label.dashboard")} — seller_owner`}
                groups={DASHBOARD_NAV}
                activeHref="/dashboard/leads"
                translate={(key) => t(key as never)}
                actor={SELLER}
                lockedLabel={t("nav.locked")}
                laterLabel={t("nav.later")}
                mark={<span className="font-serif text-h2 text-on-ink">Business Listings</span>}
              />
            </Viewport>
            <Viewport height={420}>
              <AppSidebar
                label={`${t("nav.label.dashboard")} — seller_sales`}
                groups={DASHBOARD_NAV}
                activeHref="/dashboard/leads"
                translate={(key) => t(key as never)}
                actor={SALES}
                lockedLabel={t("nav.locked")}
                laterLabel={t("nav.later")}
                mark={<span className="font-serif text-h2 text-on-ink">Business Listings</span>}
              />
            </Viewport>
          </div>
          <p className="text-caption text-muted">{t("gallery.sidebar_note")}</p>
        </States>

        <States label="staff_moderator vs staff_ops_lead" stack>
          <div className="flex gap-4">
            <Viewport height={520}>
              <AppSidebar
                label={`${t("nav.label.admin")} — staff_moderator`}
                groups={ADMIN_NAV}
                activeHref="/admin/queue"
                translate={(key) => t(key as never)}
                actor={MODERATOR}
                lockedLabel={t("nav.locked")}
                laterLabel={t("nav.later")}
                mark={
                  <span className="flex items-center gap-2">
                    <span className="rounded-tag bg-moss-on-ink px-1.5 py-px font-mono text-eyebrow uppercase text-moss-on-ink-text">
                      admin
                    </span>
                    <span className="font-serif text-h2 text-on-ink">Business Listings</span>
                  </span>
                }
              />
            </Viewport>
            <Viewport height={520}>
              <AppSidebar
                label={`${t("nav.label.admin")} — staff_ops_lead`}
                groups={ADMIN_NAV}
                activeHref="/admin/audit"
                translate={(key) => t(key as never)}
                actor={OPS}
                lockedLabel={t("nav.locked")}
                laterLabel={t("nav.later")}
                mark={
                  <span className="flex items-center gap-2">
                    <span className="rounded-tag bg-moss-on-ink px-1.5 py-px font-mono text-eyebrow uppercase text-moss-on-ink-text">
                      admin
                    </span>
                    <span className="font-serif text-h2 text-on-ink">Business Listings</span>
                  </span>
                }
              />
            </Viewport>
          </div>
        </States>
      </Section>

      <Section id="page-header" title="PageHeader" note="58px, with the autosave line where it belongs">
        <States label="states" stack>
          <div className="w-full overflow-hidden rounded-card border border-line">
            <PageHeader
              eyebrow="ENQ-8841"
              title="Resilient seated gate valves"
              savedLabel={t("shell.saved", { when: "20 seconds ago" })}
              actions={
                <>
                  <Button variant="secondary" size="sm">
                    {t("action.save_draft")}
                  </Button>
                  <Button size="sm">{t("action.send_quote")}</Button>
                </>
              }
            />
          </div>
          <div className="w-full overflow-hidden rounded-card border border-line">
            <PageHeader
              title="Al Marwan Trading"
              breadcrumb={
                <Breadcrumb
                  label={`${t("gallery.breadcrumb_label")} — page header`}
                  items={[
                    { label: "Businesses", href: "#" },
                    { label: "Al Marwan Trading" },
                  ]}
                />
              }
              meta={
                <span className="rounded-pill border border-ok-line bg-ok-wash px-2 py-0.5 font-mono text-eyebrow uppercase text-ok-ink">
                  tier 3
                </span>
              }
              tabs={
                <Tabs
                  as="a"
                  label={t("gallery.tabs_label")}
                  active="overview"
                  items={[
                    { key: "overview", label: "Overview", href: "#page-header" },
                    { key: "products", label: "Products", href: "#page-header", badge: 92 },
                    { key: "reviews", label: "Reviews", href: "#page-header" },
                  ]}
                />
              }
              actions={<IconButton label={t("action.more")} icon={<Dots size={15} />} />}
            />
          </div>
        </States>
      </Section>

      <Section
        id="shell-public"
        title="PublicShell"
        note='data-density="roomy" — set once here and inherited'
      >
        <Viewport height={420}>
          <PublicShell
            contentAs="div"
            nav={
              <PublicNav
                label={`${t("nav.label.public")} — in shell`}
                brand="Business Listings"
                search={
                  <SearchField
                    label={t("search.label")}
                    clearLabel={t("search.clear")}
                    defaultValue="gate valve DN100"
                  />
                }
                actions={<Button size="sm">{t("gallery.list_your_business")}</Button>}
              />
            }
            breadcrumb={
              <Breadcrumb
                label={`${t("gallery.breadcrumb_label")} — public shell`}
                items={[
                  { label: "Directory", href: "#" },
                  { label: "Valves & fittings", href: "#" },
                  { label: "Gate valves" },
                ]}
              />
            }
            toolbar={
              <span className="font-mono text-eyebrow tabular-nums text-muted">
                {t("shell.results_count", { count: 218 })}
              </span>
            }
            footer={
              <div className="mx-auto max-w-7xl px-5 py-6 text-caption text-muted">
                {formatCount(41_204)} listed businesses across seven emirates.
              </div>
            }
          >
            <div className="grid gap-[var(--gutter)] sm:grid-cols-2">
              {["Al Marwan Trading", "Gulf Line Industrial", "Emirates Crest", "Al Sahra General"].map((name) => (
                <Card key={name} interactive>
                  <p className="text-body-sm text-ink">{name}</p>
                  <p className="font-mono text-eyebrow text-muted">Al Quoz Industrial 1 · Dubai</p>
                </Card>
              ))}
            </div>
          </PublicShell>
        </Viewport>
      </Section>

      <Section
        id="shell-dashboard"
        title="DashboardShell"
        note='data-density="comfortable" — 46px rows, 14px gutter'
      >
        <Viewport height={460}>
          <DashboardShell
            contentAs="div"
            sidebar={
              <AppSidebar
                label={`${t("nav.label.dashboard")} — shell`}
                groups={DASHBOARD_NAV}
                activeHref="/dashboard/leads"
                translate={(key) => t(key as never)}
                actor={SELLER}
                lockedLabel={t("nav.locked")}
                laterLabel={t("nav.later")}
                mark={<span className="font-serif text-h2 text-on-ink">Business Listings</span>}
              />
            }
            header={
              <PageHeader
                title="Leads & RFQ"
                savedLabel={t("shell.saved", { when: "20 seconds ago" })}
                actions={<Button size="sm">{t("action.send_quote")}</Button>}
              />
            }
          >
            <Panel title="This week" description="Enquiries received, and how fast you answered.">
              <p className="text-body-sm text-body">
                {t("count.suppliers_in_area", { count: 7, area: "your inbox" })}
              </p>
            </Panel>
          </DashboardShell>
        </Viewport>
      </Section>

      <Section
        id="shell-admin"
        title="AdminShell"
        note='data-density="compact" — 38px rows, 10px gutter, same components'
      >
        <Viewport height={460}>
          <AdminShell
            contentAs="div"
            sidebar={
              <AppSidebar
                label={`${t("nav.label.admin")} — shell`}
                groups={ADMIN_NAV}
                activeHref="/admin/queue"
                translate={(key) => t(key as never)}
                actor={OPS}
                lockedLabel={t("nav.locked")}
                laterLabel={t("nav.later")}
                mark={
                  <span className="flex items-center gap-2">
                    <span className="rounded-tag bg-moss-on-ink px-1.5 py-px font-mono text-eyebrow uppercase text-moss-on-ink-text">
                      admin
                    </span>
                    <span className="font-serif text-h2 text-on-ink">Business Listings</span>
                  </span>
                }
              />
            }
            impersonation={
              <div className="flex items-center gap-2 bg-warn-wash px-4 py-1.5">
                <span className="text-caption text-warn-ink">
                  {t("shell.viewing_as", { name: "Al Marwan Trading" })}
                </span>
                <span className="ms-auto">
                  <IconButton size="sm" label={t("overlay.close")} icon={<Close size={13} />} />
                </span>
              </div>
            }
            header={
              <PageHeader
                title="Approval queue"
                meta={
                  <span className="rounded-pill border border-warn-line bg-warn-wash px-2 py-0.5 font-mono text-eyebrow tabular-nums text-warn-ink">
                    34 waiting
                  </span>
                }
                actions={<Button size="sm" variant="secondary">{t("table.export")}</Button>}
              />
            }
          >
            <Panel title="Oldest first">
              <p className="text-body-sm text-body">{t("gallery.queue_body")}</p>
            </Panel>
          </AdminShell>
        </Viewport>
      </Section>

      <Section
        id="builder-chrome"
        title="BuilderChrome"
        note="ink bar, no sidebar — the surface below is the whole job"
      >
        <Viewport height={380}>
          <BuilderChrome
            contentAs="div"
            title="Storefront template"
            subtitle="AL-MARWAN / DRAFT"
            status={t("shell.saved", { when: "8 seconds ago" })}
            exit={
              // ghost is a light-surface variant: --text-body on --ink is
              // 1.66:1. The design system names no on-ink button treatment, so
              // a secondary chip is used here and the gap is recorded in
              // docs/inferred.md.
              <Button variant="secondary" size="sm" leadingIcon={<Close size={14} />}>
                {t("shell.exit")}
              </Button>
            }
            commit={<Button size="sm">{t("shell.publish")}</Button>}
            toolbar={
              <Tabs
                variant="enclosed"
                label={t("gallery.tabs_label")}
                active="desktop"
                items={[
                  { key: "desktop", label: "Desktop" },
                  { key: "mobile", label: "Mobile" },
                ]}
              />
            }
          >
            <div className="mx-auto max-w-3xl p-6">
              <Card elevation="raised">
                <p className="font-serif text-h1-serif text-ink">Al Marwan Trading</p>
                <p className="mt-1 text-body-sm text-muted">
                  Valves and fittings · Al Quoz Industrial 1
                </p>
              </Card>
            </div>
          </BuilderChrome>
        </Viewport>
      </Section>
    </>
  );
}
