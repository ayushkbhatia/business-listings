"use client";

import { useState } from "react";
import {
  Button,
  IconButton,
  SegmentedControl,
  SplitButton,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/primitives";
import { Close, Dots, Plus, Search } from "@/components/primitives/icons";
import { t } from "@/lib/i18n";
import { Section, Specimen, States } from "../_kit";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger", "link"];
const SIZES: ButtonSize[] = ["sm", "md", "lg", "xl"];

export function Actions() {
  const [tab, setTab] = useState<"businesses" | "products">("businesses");
  const [density, setDensity] = useState<"roomy" | "comfortable" | "compact">("comfortable");

  return (
    <>
      <Section
        id="button"
        title="Button"
        note="5 variants × 4 sizes × default, hover, focus, disabled, loading"
      >
        {VARIANTS.map((variant) => (
          <States key={variant} label={variant}>
            <Specimen caption="default">
              <Button variant={variant}>{t("action.save")}</Button>
            </Specimen>
            <Specimen caption="hover">
              <Button variant={variant} data-force="hover">
                {t("action.save")}
              </Button>
            </Specimen>
            <Specimen caption="focus">
              <Button variant={variant} data-force="focus">
                {t("action.save")}
              </Button>
            </Specimen>
            <Specimen caption="disabled">
              <Button variant={variant} disabled>
                {t("action.save")}
              </Button>
            </Specimen>
            <Specimen caption="loading">
              <Button variant={variant} loading>
                {t("action.save")}
              </Button>
            </Specimen>
          </States>
        ))}

        <States label="sizes">
          {SIZES.map((size) => (
            <Specimen key={size} caption={size}>
              <Button size={size}>{t("action.send_enquiry")}</Button>
            </Specimen>
          ))}
        </States>

        <States label="with icons">
          <Specimen caption="leading">
            <Button leadingIcon={<Plus size={14} />}>{t("action.duplicate")}</Button>
          </Specimen>
          <Specimen caption="trailing">
            <Button variant="secondary" trailingIcon={<Search size={14} />}>
              {t("search.label")}
            </Button>
          </Specimen>
          <Specimen caption="block">
            <div className="w-56">
              <Button block>{t("action.send_quote")}</Button>
            </div>
          </Specimen>
        </States>
      </Section>

      <Section id="icon-button" title="IconButton" note="label is required, and is also the tooltip">
        {(["ghost", "secondary", "primary", "danger"] as ButtonVariant[]).map((variant) => (
          <States key={variant} label={variant}>
            <Specimen caption="default">
              <IconButton variant={variant} label={t("action.more")} icon={<Dots size={15} />} />
            </Specimen>
            <Specimen caption="hover">
              <IconButton
                variant={variant}
                label={t("action.more")}
                icon={<Dots size={15} />}
                data-force="hover"
              />
            </Specimen>
            <Specimen caption="focus">
              <IconButton
                variant={variant}
                label={t("action.more")}
                icon={<Dots size={15} />}
                data-force="focus"
              />
            </Specimen>
            <Specimen caption="disabled">
              <IconButton variant={variant} label={t("action.more")} icon={<Dots size={15} />} disabled />
            </Specimen>
            <Specimen caption="loading">
              <IconButton variant={variant} label={t("action.more")} icon={<Dots size={15} />} loading />
            </Specimen>
          </States>
        ))}
        <States label="sizes">
          {SIZES.map((size) => (
            <Specimen key={size} caption={size}>
              <IconButton size={size} variant="secondary" label={t("field.clear")} icon={<Close size={15} />} />
            </Specimen>
          ))}
        </States>
      </Section>

      <Section
        id="split-button"
        title="SplitButton"
        note="one visible action, the rest behind the chevron"
      >
        <States label="primary">
          <Specimen caption="closed">
            <SplitButton
              onClick={() => {}}
              menuLabel={t("action.more")}
              items={[
                { key: "draft", label: t("action.save_draft"), onSelect: () => {} },
                { key: "dup", label: t("action.duplicate"), onSelect: () => {} },
                { key: "del", label: t("action.delete"), onSelect: () => {}, destructive: true },
              ]}
            >
              {t("action.send_quote")}
            </SplitButton>
          </Specimen>
          <Specimen caption="disabled">
            <SplitButton
              disabled
              onClick={() => {}}
              menuLabel={t("action.more")}
              items={[{ key: "draft", label: t("action.save_draft"), onSelect: () => {} }]}
            >
              {t("action.send_quote")}
            </SplitButton>
          </Specimen>
          <Specimen caption="loading">
            <SplitButton
              loading
              onClick={() => {}}
              menuLabel={t("action.more")}
              items={[{ key: "draft", label: t("action.save_draft"), onSelect: () => {} }]}
            >
              {t("action.send_quote")}
            </SplitButton>
          </Specimen>
        </States>
        <States label="secondary">
          {(["sm", "md", "lg"] as const).map((size) => (
            <Specimen key={size} caption={size}>
              <SplitButton
                variant="secondary"
                size={size}
                onClick={() => {}}
                menuLabel={t("action.more")}
                items={[
                  { key: "dup", label: t("action.duplicate"), onSelect: () => {} },
                  { key: "arch", label: t("action.archive"), onSelect: () => {} },
                ]}
              >
                {t("action.save")}
              </SplitButton>
            </Specimen>
          ))}
        </States>
      </Section>

      <Section
        id="segmented-control"
        title="SegmentedControl"
        note="radiogroup — arrow keys move, the group is one tab stop"
      >
        <States label="two options">
          <Specimen caption="live">
            <SegmentedControl
              label={t("search.label")}
              value={tab}
              onChange={setTab}
              options={[
                { value: "businesses", label: t("gallery.tab_businesses") },
                { value: "products", label: t("gallery.tab_products") },
              ]}
            />
          </Specimen>
        </States>
        <States label="three options">
          <Specimen caption="live, small">
            <SegmentedControl
              size="sm"
              label={t("gallery.density")}
              value={density}
              onChange={setDensity}
              options={[
                { value: "roomy", label: t("gallery.roomy") },
                { value: "comfortable", label: t("gallery.comfortable") },
                { value: "compact", label: t("gallery.compact") },
              ]}
            />
          </Specimen>
          <Specimen caption="with a disabled option">
            <SegmentedControl
              label={t("trade.terms")}
              value="advance"
              onChange={() => {}}
              options={[
                { value: "advance", label: t("trade.terms_advance") },
                { value: "net30", label: t("trade.terms_net30") },
                { value: "lc", label: t("trade.terms_lc"), disabled: true },
              ]}
            />
          </Specimen>
        </States>
        <States label="block">
          <div className="w-80">
            <SegmentedControl
              block
              label={t("search.label")}
              value={tab}
              onChange={setTab}
              options={[
                { value: "businesses", label: t("gallery.tab_businesses") },
                { value: "products", label: t("gallery.tab_products") },
              ]}
            />
          </div>
        </States>
      </Section>
    </>
  );
}
