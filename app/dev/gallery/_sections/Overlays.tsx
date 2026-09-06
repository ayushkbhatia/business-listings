"use client";

import { useState } from "react";
import { Button, Checkbox, Textarea } from "@/components/primitives";
import { Drawer, FilterRail, Modal } from "@/components/structure";
import { t } from "@/lib/i18n";
import { Section, Specimen, States } from "../_kit";

export function Overlays() {
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [applied, setApplied] = useState(2);

  return (
    <>
      <Section
        id="modal"
        title="Modal"
        note="native <dialog> — the focus trap, the inert page and Escape come from the platform"
      >
        <States label="states">
          <Specimen caption="content">
            <Button variant="secondary" onClick={() => setModal(true)}>
              {t("gallery.open_modal")}
            </Button>
          </Specimen>
          <Specimen caption="destructive confirm">
            <Button variant="danger" onClick={() => setConfirm(true)}>
              {t("overlay.remove_review_confirm")}
            </Button>
          </Specimen>
        </States>

        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title={t("gallery.open_modal")}
          description={t("trade.requirement_hint")}
          closeLabel={t("overlay.close")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(false)}>
                {t("action.cancel")}
              </Button>
              <Button onClick={() => setModal(false)}>{t("action.save")}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Textarea
              aria-label={t("trade.requirement")}
              rows={3}
              limit={400}
              counterLabel={(used, limit) => t("field.counter", { used, limit })}
            />
            <Checkbox label={t("trade.whatsapp_updates")} />
          </div>
        </Modal>

        <Modal
          open={confirm}
          onClose={() => setConfirm(false)}
          size="sm"
          title={t("overlay.remove_review_title")}
          description={t("overlay.remove_review_body")}
          closeLabel={t("overlay.close")}
          footer={
            <>
              {/* Cancel sits left and is never red. The confirm repeats the
                  verb — "Remove review", not "OK". */}
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                {t("action.cancel")}
              </Button>
              <Button variant="danger" onClick={() => setConfirm(false)}>
                {t("overlay.remove_review_confirm")}
              </Button>
            </>
          }
        >
          <Textarea
            aria-label={t("error.reason.required")}
            rows={3}
            placeholder={t("error.reason.required")}
          />
        </Modal>
      </Section>

      <Section id="drawer" title="Drawer" note="keeps the context behind it visible; side is start/end, never left/right">
        <States label="states">
          <Specimen caption="end">
            <Button variant="secondary" onClick={() => setDrawer(true)}>
              {t("overlay.filters_title")}
            </Button>
          </Specimen>
        </States>

        <Drawer
          open={drawer}
          onClose={() => setDrawer(false)}
          title={t("overlay.filters_title")}
          closeLabel={t("overlay.close")}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setApplied(0)}>
                {t("table.clear_filters")}
              </Button>
              <Button onClick={() => setDrawer(false)}>{t("action.save")}</Button>
            </div>
          }
        >
          <FilterRail
            label={`${t("overlay.filters_title")} — in drawer`}
            appliedCount={applied}
            appliedLabel={t("table.filters_applied", { count: applied })}
            clearAllLabel={t("table.clear_filters")}
            onClearAll={() => setApplied(0)}
            sections={[
              {
                key: "tier",
                label: "Verification tier",
                activeCount: 1,
                children: (
                  <>
                    {/*
                       Two rungs, not four. The ladder lost the visited tiers on
                       5 Sep and this specimen kept them — on the one surface whose
                       job is showing what the shipped components do. See
                       components/domain/verification.ts.
                    */}
                    <Checkbox label="Tier 2 — licence verified" defaultChecked />
                    <Checkbox label="Tier 1 — claimed" />
                  </>
                ),
              },
              {
                key: "dn",
                label: "Nominal diameter",
                activeCount: 1,
                children: (
                  <>
                    <Checkbox label="DN50" />
                    <Checkbox label="DN100" defaultChecked />
                    <Checkbox label="DN150" />
                  </>
                ),
              },
              {
                key: "availability",
                label: "Availability",
                children: (
                  <>
                    <Checkbox label={t("availability.in_stock")} />
                    <Checkbox label={t("availability.made_to_order")} />
                  </>
                ),
              },
            ]}
          />
        </Drawer>
      </Section>

      <Section
        id="filter-rail"
        title="FilterRail"
        note="generated from the category's filterable spec fields — no code change when a template changes"
      >
        <States label="states" stack>
          <div className="w-72 rounded-card border border-line bg-card px-3">
            <FilterRail
              label={`${t("overlay.filters_title")} — rail`}
              appliedCount={applied}
              appliedLabel={t("table.filters_applied", { count: applied })}
              clearAllLabel={t("table.clear_filters")}
              onClearAll={() => setApplied(0)}
              sections={[
                {
                  key: "tier",
                  label: "Verification tier",
                  activeCount: 1,
                  children: (
                    <>
                      {/*
                         Two rungs, not four. The ladder lost the visited tiers on
                         5 Sep and this specimen kept them — on the one surface whose
                         job is showing what the shipped components do. See
                         components/domain/verification.ts.
                      */}
                      <Checkbox label="Tier 2 — licence verified" defaultChecked />
                      <Checkbox label="Tier 1 — claimed" />
                      <Checkbox label="Tier 1 — licence on file" />
                    </>
                  ),
                },
                {
                  key: "pressure",
                  label: "Pressure rating",
                  activeCount: 1,
                  children: (
                    <>
                      <Checkbox label="PN16" defaultChecked />
                      <Checkbox label="PN25" />
                      <Checkbox label="Class 150" />
                    </>
                  ),
                },
                {
                  key: "zone",
                  label: "Free zone",
                  defaultOpen: false,
                  children: <Checkbox label="Free zone only" />,
                },
              ]}
            />
          </div>
        </States>
      </Section>
    </>
  );
}
