"use client";

import { useState } from "react";
import {
  Checkbox,
  MultiSelect,
  Radio,
  RadioGroup,
  Select,
  Toggle,
} from "@/components/primitives";
import { t } from "@/lib/i18n";
import { Frame, Section, Specimen, States } from "../_kit";

const EMIRATES = [
  { value: "dubai", label: "Dubai" },
  { value: "abu_dhabi", label: "Abu Dhabi" },
  { value: "sharjah", label: "Sharjah" },
  { value: "ajman", label: "Ajman" },
];

const CERTIFICATIONS = [
  { value: "wras", label: "WRAS" },
  { value: "fm", label: "FM approved" },
  { value: "ul", label: "UL listed" },
  { value: "api6d", label: "API 6D" },
  { value: "iso9001", label: "ISO 9001" },
  { value: "en1074", label: "EN 1074" },
  { value: "ce", label: "CE" },
  { value: "kitemark", label: "Kitemark" },
  { value: "sasо", label: "SASO" },
];

export function Choice() {
  const [certs, setCerts] = useState<string[]>(["wras", "fm"]);
  const [many, setMany] = useState<string[]>(["wras", "fm", "ul", "api6d"]);
  const [whatsapp, setWhatsapp] = useState(true);
  const [pendingToggle, setPendingToggle] = useState(false);
  const [terms, setTerms] = useState("net30");

  return (
    <>
      <Section id="select" title="Select" note="native, so a phone gets the platform picker">
        <States label="states" stack>
          <div className="w-72">
            <Select aria-label={t("gallery.specimen", { component: "Select", state: "empty" })} options={EMIRATES} placeholder={t("field.choose")} />
          </div>
          <div className="w-72">
            <Select aria-label={t("gallery.specimen", { component: "Select", state: "chosen" })} options={EMIRATES} defaultValue="dubai" />
          </div>
          <div className="w-72">
            <Select aria-label={t("gallery.specimen", { component: "Select", state: "focus" })} options={EMIRATES} defaultValue="dubai" data-force="focus" />
          </div>
          <div className="w-72">
            <Select aria-label={t("gallery.specimen", { component: "Select", state: "invalid" })} options={EMIRATES} invalid placeholder={t("field.choose")} />
          </div>
          <div className="w-72">
            <Select aria-label={t("gallery.specimen", { component: "Select", state: "disabled" })} options={EMIRATES} disabled defaultValue="dubai" />
          </div>
        </States>
        <States label="grouped" stack>
          <div className="w-72">
            <Select
              aria-label={t("gallery.specimen", { component: "Select", state: "grouped" })}
              options={[]}
              placeholder={t("field.choose")}
              groups={[
                { label: "Mainland", options: EMIRATES },
                {
                  label: "Free zone",
                  options: [
                    { value: "jafza", label: "JAFZA" },
                    { value: "saif", label: "SAIF Zone" },
                    { value: "kizad", label: "KIZAD" },
                  ],
                },
              ]}
            />
          </div>
        </States>
        <States label="sizes" stack>
          {(["sm", "md", "lg"] as const).map((size) => (
            <div key={size} className="w-72">
              <Select
                size={size}
                aria-label={t("gallery.specimen", { component: "Select", state: size })}
                options={EMIRATES}
                defaultValue="dubai"
              />
            </div>
          ))}
        </States>
      </Section>

      <Section
        id="multi-select"
        title="MultiSelect"
        note="chips show the answer without opening anything; a filter box appears past eight options"
      >
        <States label="states" stack>
          <div className="w-80">
            <MultiSelect
              label={t("trade.certifications")}
              options={CERTIFICATIONS.slice(0, 6)}
              value={[]}
              onChange={() => {}}
              placeholder={t("field.choose")}
              emptyLabel={t("field.no_matches")}
            />
          </div>
          <div className="w-80">
            <MultiSelect
              label={t("trade.certifications")}
              options={CERTIFICATIONS}
              value={certs}
              onChange={setCerts}
              placeholder={t("field.choose")}
              filterPlaceholder={t("field.filter_placeholder")}
              emptyLabel={t("field.no_matches")}
              removeLabel={(item) => t("field.remove", { item })}
              summaryLabel={(count) => t("field.more", { count })}
            />
          </div>
          <div className="w-80">
            <MultiSelect
              label={t("trade.certifications")}
              options={CERTIFICATIONS}
              value={many}
              onChange={setMany}
              placeholder={t("field.choose")}
              filterPlaceholder={t("field.filter_placeholder")}
              emptyLabel={t("field.no_matches")}
              removeLabel={(item) => t("field.remove", { item })}
              summaryLabel={(count) => t("field.more", { count })}
            />
          </div>
          <div className="w-80">
            <MultiSelect
              invalid
              label={t("trade.certifications")}
              options={CERTIFICATIONS.slice(0, 4)}
              value={[]}
              onChange={() => {}}
              placeholder={t("field.choose")}
              emptyLabel={t("field.no_matches")}
            />
          </div>
          <div className="w-80">
            <MultiSelect
              disabled
              label={t("trade.certifications")}
              options={CERTIFICATIONS.slice(0, 4)}
              value={["wras"]}
              onChange={() => {}}
              placeholder={t("field.choose")}
              emptyLabel={t("field.no_matches")}
            />
          </div>
        </States>
      </Section>

      <Section
        id="checkbox"
        title="Checkbox"
        note="applies on save — never in the same section as a Toggle"
      >
        <States label="states">
          <Specimen caption="unchecked">
            <Checkbox label={t("trade.publish_listing")} />
          </Specimen>
          <Specimen caption="checked">
            <Checkbox label={t("trade.publish_listing")} defaultChecked />
          </Specimen>
          <Specimen caption="indeterminate">
            <Checkbox label={t("field.select_all")} indeterminate />
          </Specimen>
          <Specimen caption="focus">
            <Checkbox label={t("trade.publish_listing")} data-force="focus" />
          </Specimen>
          <Specimen caption="invalid">
            <Checkbox label={t("trade.publish_listing")} invalid />
          </Specimen>
          <Specimen caption="disabled">
            <Checkbox label={t("trade.publish_listing")} disabled />
          </Specimen>
          <Specimen caption="disabled + checked">
            <Checkbox label={t("trade.publish_listing")} disabled defaultChecked />
          </Specimen>
        </States>
        <States label="with description" stack>
          <Checkbox
            label={t("trade.hide_phone")}
            description={t("trade.requirement_hint")}
            defaultChecked
          />
        </States>
        <States label="no label">
          <Specimen caption="row selector">
            <Checkbox aria-label={t("field.select_all")} />
          </Specimen>
        </States>
      </Section>

      <Section id="radio" title="Radio" note="a fieldset and legend, so the question is announced">
        <States label="vertical" stack>
          <RadioGroup legend={t("trade.terms")} hint={t("trade.requirement_hint")}>
            <Radio
              name="terms-v"
              value="advance"
              label={t("trade.terms_advance")}
              checked={terms === "advance"}
              onChange={() => setTerms("advance")}
            />
            <Radio
              name="terms-v"
              value="net30"
              label={t("trade.terms_net30")}
              description={t("trade.lead_time_range", { from: 25, to: 35 })}
              checked={terms === "net30"}
              onChange={() => setTerms("net30")}
            />
            <Radio name="terms-v" value="lc" label={t("trade.terms_lc")} disabled />
          </RadioGroup>
        </States>
        <States label="horizontal" stack>
          <RadioGroup legend={t("trade.terms")} orientation="horizontal">
            <Radio name="terms-h" value="advance" label={t("trade.terms_advance")} defaultChecked />
            <Radio name="terms-h" value="net30" label={t("trade.terms_net30")} />
            <Radio name="terms-h" value="lc" label={t("trade.terms_lc")} />
          </RadioGroup>
        </States>
        <States label="focus">
          <Radio name="terms-f" value="a" label={t("trade.terms_advance")} data-force="focus" />
        </States>
      </Section>

      <Section
        id="toggle"
        title="Toggle"
        note="applies immediately, so it has a pending state and can fail"
      >
        <States label="states">
          <Specimen caption="off">
            <Toggle checked={false} onChange={() => {}} label={t("trade.whatsapp_updates")} />
          </Specimen>
          <Specimen caption="on">
            <Toggle checked onChange={() => {}} label={t("trade.whatsapp_updates")} />
          </Specimen>
          <Specimen caption="pending">
            <Toggle checked pending onChange={() => {}} label={t("trade.whatsapp_updates")} />
          </Specimen>
          <Specimen caption="disabled">
            <Toggle checked={false} disabled onChange={() => {}} label={t("trade.whatsapp_updates")} />
          </Specimen>
        </States>
        <States label="live" stack>
          <Toggle
            checked={whatsapp}
            onChange={setWhatsapp}
            label={t("trade.whatsapp_updates")}
            description={t("trade.whatsapp_updates_hint")}
          />
          <Toggle
            checked={pendingToggle}
            onChange={setPendingToggle}
            size="sm"
            label={t("trade.publish_listing")}
          />
        </States>
        <States label="label hidden">
          <Toggle checked hideLabel onChange={() => {}} label={t("trade.publish_listing")} />
        </States>
      </Section>

      <Section id="mixing" title="Toggle beside Checkbox" note="the one arrangement the design system forbids">
        <Frame width="30rem">
          <p className="text-caption text-muted">{t("gallery.mixing_note")}</p>
        </Frame>
      </Section>
    </>
  );
}
