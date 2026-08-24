"use client";

import { useState } from "react";
import {
  FieldError,
  Input,
  Label,
  SearchField,
  Textarea,
} from "@/components/primitives";
import { Search } from "@/components/primitives/icons";
import { t } from "@/lib/i18n";
import { Frame, Section, States } from "../_kit";

export function TextEntry() {
  const [query, setQuery] = useState("gate valve DN100");
  const [requirement, setRequirement] = useState(
    "24 off DN100 resilient seated gate valves, flanged PN16, delivered to Al Quoz over three weeks.",
  );

  return (
    <>
      <Section id="label" title="Label" note="required is a word, never an asterisk">
        <States label="requirement" stack>
          <Label requirement="required" requirementLabel={t("field.required")}>
            {t("trade.licence_number")}
          </Label>
          <Label requirement="optional" requirementLabel={t("field.optional")}>
            {t("trade.trn")}
          </Label>
          <Label>{t("trade.emirate")}</Label>
        </States>
        <States label="with hint" stack>
          <Label
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("trade.licence_hint")}
          >
            {t("trade.licence_number")}
          </Label>
        </States>
        <States label="disabled" stack>
          <Label disabled requirement="required" requirementLabel={t("field.required")}>
            {t("trade.licence_number")}
          </Label>
        </States>
      </Section>

      <Section id="field-error" title="FieldError" note="what is wrong, and what correct looks like">
        <States label="states" stack>
          <FieldError>{t("error.phone.format")}</FieldError>
          <FieldError>{t("error.trn.format")}</FieldError>
          <FieldError code="PERM-1KQ4V8B">{t("error.permission", { code: "" })}</FieldError>
          <div className="rounded-tag border border-dashed border-line px-2 py-1">
            <FieldError />
          </div>
        </States>
      </Section>

      <Section id="input" title="Input" note="validation timing belongs to the form, not the control">
        <States label="states" stack>
          <div className="w-80">
            <Input aria-label={t("gallery.specimen", { component: "Input", state: "empty" })} placeholder={t("field.choose")} defaultValue="" />
          </div>
          <div className="w-80">
            <Input aria-label={t("gallery.specimen", { component: "Input", state: "filled" })} defaultValue="Al Marwan Trading" />
          </div>
          <div className="w-80">
            <Input aria-label={t("gallery.specimen", { component: "Input", state: "focus" })} data-force="focus" defaultValue="Al Marwan Trading" />
          </div>
          <div className="w-80">
            <Input aria-label={t("gallery.specimen", { component: "Input", state: "invalid" })} invalid defaultValue="04-883" aria-describedby="phone-err" />
            <div className="mt-1">
              <FieldError id="phone-err">{t("error.phone.format")}</FieldError>
            </div>
          </div>
          <div className="w-80">
            <Input aria-label={t("gallery.specimen", { component: "Input", state: "read only" })} readOnly defaultValue="DED-618402" mono />
          </div>
          <div className="w-80">
            <Input aria-label={t("gallery.specimen", { component: "Input", state: "disabled" })} disabled defaultValue="DED-618402" />
          </div>
        </States>

        <States label="sizes" stack>
          {(["sm", "md", "lg"] as const).map((size) => (
            <div key={size} className="w-80">
              <Input
                size={size}
                aria-label={t("gallery.specimen", { component: "Input", state: size })}
                placeholder={size}
              />
            </div>
          ))}
        </States>

        <States label="adornments" stack>
          <div className="w-80">
            <Input aria-label={t("gallery.specimen", { component: "Input", state: "leading icon" })} leadingIcon={<Search size={14} />} placeholder={t("search.placeholder")} />
          </div>
          <div className="w-80">
            <Input aria-label={t("gallery.specimen", { component: "Input", state: "suffix" })} suffix="mm" defaultValue="114.3" mono />
          </div>
          <div className="w-80">
            <Input aria-label={t("gallery.specimen", { component: "Input", state: "mono" })} mono defaultValue="100 1234 5678 3003" suffix="TRN" />
          </div>
        </States>
      </Section>

      <Section
        id="textarea"
        title="Textarea"
        note="the counter warns and then flags, and never blocks a paste"
      >
        <States label="states" stack>
          <div className="w-full max-w-xl">
            <Textarea
              aria-label={t("gallery.specimen", { component: "Textarea", state: "empty" })}
              placeholder={t("trade.requirement_hint")}
              limit={600}
              counterLabel={(used, limit) => t("field.counter", { used, limit })}
            />
          </div>
          <div className="w-full max-w-xl">
            <Textarea
              aria-label={t("gallery.specimen", { component: "Textarea", state: "over limit" })}
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              limit={140}
              counterLabel={(used, limit) => t("field.counter", { used, limit })}
            />
          </div>
          <div className="w-full max-w-xl">
            <Textarea
              aria-label={t("gallery.specimen", { component: "Textarea", state: "read only" })}
              readOnly
              defaultValue="Supplied ex-stock or to order. Datasheet available on request."
              rows={2}
            />
          </div>
          <div className="w-full max-w-xl">
            <Textarea aria-label={t("gallery.specimen", { component: "Textarea", state: "disabled" })} disabled defaultValue="Locked while the listing is in moderation." rows={2} />
          </div>
        </States>
      </Section>

      <Section id="search-field" title="SearchField" note="the clear button is real, so it can be tabbed to">
        <States label="states" stack>
          <div className="w-96">
            <SearchField
              label={t("search.label")}
              clearLabel={t("search.clear")}
              placeholder={t("search.placeholder")}
            />
          </div>
          <div className="w-96">
            <SearchField
              label={t("search.label")}
              clearLabel={t("search.clear")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
            />
          </div>
          <div className="w-96">
            <SearchField
              label={t("search.label")}
              clearLabel={t("search.clear")}
              loading
              defaultValue="butterfly valve"
            />
          </div>
          <div className="w-96">
            <SearchField
              label={t("search.label")}
              clearLabel={t("search.clear")}
              disabled
              placeholder={t("search.placeholder")}
            />
          </div>
        </States>
        <States label="sizes" stack>
          {(["sm", "md", "lg"] as const).map((size) => (
            <div key={size} className="w-96">
              <SearchField
                size={size}
                label={t("search.label")}
                clearLabel={t("search.clear")}
                placeholder={size}
              />
            </div>
          ))}
        </States>
      </Section>

      <Section id="field-composition" title="Composed field" note="Label + control + FieldError">
        <Frame width="26rem">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="composed-trn"
              requirement="required"
              requirementLabel={t("field.required")}
              hint={t("trade.trn_hint")}
            >
              {t("trade.trn")}
            </Label>
            <Input id="composed-trn" mono invalid defaultValue="1001234" aria-describedby="composed-trn-err" />
            <FieldError id="composed-trn-err">{t("error.trn.format")}</FieldError>
          </div>
        </Frame>
      </Section>
    </>
  );
}
