"use client";

import { useState } from "react";
import { RangeSlider, Stepper, TimePair } from "@/components/primitives";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Section, Specimen, States } from "../_kit";

export function Numeric() {
  const [lead, setLead] = useState<[number, number]>([7, 28]);
  const [qty, setQty] = useState(24);
  const [moq, setMoq] = useState(1);
  const [morning, setMorning] = useState({ open: "08:00", close: "13:00" });
  const [broken, setBroken] = useState({ open: "16:00", close: "09:00" });

  return (
    <>
      <Section
        id="range-slider"
        title="RangeSlider"
        note="two native inputs on one track — arrow keys, Home and End all work"
      >
        <States label="states" stack>
          <div className="w-80">
            <RangeSlider
              min={0}
              max={90}
              value={lead}
              onChange={setLead}
              minLabel={t("trade.lead_time")}
              maxLabel={t("trade.lead_time")}
              formatValue={([from, to]) => t("trade.lead_time_range", { from, to })}
            />
          </div>
          <div className="w-80">
            <RangeSlider
              min={0}
              max={90}
              value={[0, 90]}
              onChange={() => {}}
              minLabel={t("trade.lead_time")}
              maxLabel={t("trade.lead_time")}
              formatValue={([from, to]) => t("trade.lead_time_range", { from, to })}
            />
          </div>
          <div className="w-80">
            <RangeSlider
              disabled
              min={0}
              max={90}
              value={[14, 42]}
              onChange={() => {}}
              minLabel={t("trade.lead_time")}
              maxLabel={t("trade.lead_time")}
              formatValue={([from, to]) => t("trade.lead_time_range", { from, to })}
            />
          </div>
        </States>
      </Section>

      <Section
        id="stepper"
        title="Stepper"
        note="the number is a real input — nobody presses a button 240 times"
      >
        <States label="states">
          <Specimen caption="live">
            <Stepper
              value={qty}
              onChange={setQty}
              min={1}
              max={9999}
              label={t("trade.min_order")}
              decrementLabel={t("field.decrease", { field: t("trade.min_order") })}
              incrementLabel={t("field.increase", { field: t("trade.min_order") })}
              suffix="pcs"
            />
          </Specimen>
          <Specimen caption="at minimum">
            <Stepper
              value={moq}
              onChange={setMoq}
              min={1}
              label={t("trade.min_order")}
              decrementLabel={t("field.decrease", { field: t("trade.min_order") })}
              incrementLabel={t("field.increase", { field: t("trade.min_order") })}
            />
          </Specimen>
          <Specimen caption="at maximum">
            <Stepper
              value={10}
              onChange={() => {}}
              min={1}
              max={10}
              label={t("trade.min_order")}
              decrementLabel={t("field.decrease", { field: t("trade.min_order") })}
              incrementLabel={t("field.increase", { field: t("trade.min_order") })}
            />
          </Specimen>
          <Specimen caption="invalid">
            <Stepper
              invalid
              value={0}
              onChange={() => {}}
              label={t("trade.min_order")}
              decrementLabel={t("field.decrease", { field: t("trade.min_order") })}
              incrementLabel={t("field.increase", { field: t("trade.min_order") })}
            />
          </Specimen>
          <Specimen caption="disabled">
            <Stepper
              disabled
              value={5}
              onChange={() => {}}
              label={t("trade.min_order")}
              decrementLabel={t("field.decrease", { field: t("trade.min_order") })}
              incrementLabel={t("field.increase", { field: t("trade.min_order") })}
            />
          </Specimen>
          <Specimen caption="small">
            <Stepper
              size="sm"
              value={3}
              onChange={() => {}}
              label={t("trade.min_order")}
              decrementLabel={t("field.decrease", { field: t("trade.min_order") })}
              incrementLabel={t("field.increase", { field: t("trade.min_order") })}
            />
          </Specimen>
        </States>
        <States label="live value">
          <span className="font-mono text-body-sm tabular-nums text-muted">
            {formatCount(qty)}
          </span>
        </States>
      </Section>

      <Section
        id="time-pair"
        title="TimePair"
        note="24-hour; a close at or before its open is flagged as it happens"
      >
        <States label="states" stack>
          <TimePair
            open={morning.open}
            close={morning.close}
            onChange={setMorning}
            openLabel={t("field.opens_at")}
            closeLabel={t("field.closes_at")}
            orderErrorLabel={t("field.close_before_open")}
          />
          <TimePair
            open={broken.open}
            close={broken.close}
            onChange={setBroken}
            openLabel={t("field.opens_at")}
            closeLabel={t("field.closes_at")}
            orderErrorLabel={t("field.close_before_open")}
          />
          <TimePair
            open="09:00"
            close="15:00"
            onChange={() => {}}
            disabled
            openLabel={t("field.opens_at")}
            closeLabel={t("field.closes_at")}
          />
        </States>
      </Section>
    </>
  );
}
