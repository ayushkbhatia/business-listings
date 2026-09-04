import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "@/components/display/ProgressBar";

/**
 * Component 41's target marker — the inventory has described it since handoff 1
 * and nothing rendered it, so board 8a said the threshold in a sentence and left
 * the bar silent about it.
 *
 * What is worth testing here is not the rule's position, which a screenshot
 * shows better than an assertion. It is the three things a screenshot cannot:
 * that a mark never lands flush against an edge where it reads as a border, that
 * it is invisible to a screen reader because the words beside it are what carry
 * it, and that the words cannot be omitted.
 */

const LABEL = "Profile strength";
const TARGET_LABEL = "80% — where a listing stops looking thin to a buyer";

/** The rule itself. It has no role and no name, so nothing else can find it. */
function marker(container: HTMLElement): Element | null {
  return container.querySelector("[aria-hidden='true']");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("no target, no mark", () => {
  it("draws nothing when no target is passed", () => {
    // Every caller that shipped before the prop existed is in this state, and
    // none of them may gain a mark by upgrading.
    const { container } = render(<ProgressBar label={LABEL} value={72} valueLabel="72%" />);
    expect(marker(container)).toBeNull();
  });

  it("keeps the bar itself unchanged", () => {
    render(<ProgressBar label={LABEL} value={72} valueLabel="72%" />);
    const bar = screen.getByRole("progressbar", { name: LABEL });
    expect(bar).toHaveAttribute("aria-valuenow", "72");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "72%");
    expect(bar).not.toHaveAttribute("aria-describedby");
  });
});

describe("a mark flush against an edge is not a mark", () => {
  it("draws nothing at a target of 0", () => {
    // A rule at 0% reads as the left cap of the track, not as a threshold.
    const { container } = render(
      <ProgressBar label={LABEL} value={72} valueLabel="72%" target={0} targetLabel={TARGET_LABEL} />,
    );
    expect(marker(container)).toBeNull();
  });

  it("draws nothing at a target of max", () => {
    const { container } = render(
      <ProgressBar
        label={LABEL}
        value={72}
        valueLabel="72%"
        target={100}
        targetLabel={TARGET_LABEL}
      />,
    );
    expect(marker(container)).toBeNull();
  });

  it("draws nothing beyond max", () => {
    const { container } = render(
      <ProgressBar
        label={LABEL}
        value={14}
        max={22}
        valueLabel="14 / 22 fields"
        target={30}
        targetLabel={TARGET_LABEL}
      />,
    );
    expect(marker(container)).toBeNull();
  });

  it("still says what the figure was, because the sentence is the point", () => {
    render(
      <ProgressBar label={LABEL} value={72} valueLabel="72%" target={0} targetLabel={TARGET_LABEL} />,
    );
    expect(screen.getByText(TARGET_LABEL)).toBeInTheDocument();
  });
});

describe("an interior target draws a rule the reader can also read", () => {
  it("draws the rule", () => {
    const { container } = render(
      <ProgressBar label={LABEL} value={62} valueLabel="62%" target={80} targetLabel={TARGET_LABEL} />,
    );
    expect(marker(container)).not.toBeNull();
  });

  it("positions it at the target, not at the value", () => {
    const { container } = render(
      <ProgressBar label={LABEL} value={62} valueLabel="62%" target={80} targetLabel={TARGET_LABEL} />,
    );
    // Logical, not physical: the mark has to stay on its percentage in Arabic.
    expect((marker(container) as HTMLElement).style.insetInlineStart).toBe("80%");
  });

  it("scales the target against max, like the value", () => {
    const { container } = render(
      <ProgressBar
        label={LABEL}
        value={9}
        max={22}
        valueLabel="9 / 22 fields"
        target={11}
        targetLabel="11 of 22 is where a spec stops being mostly holes"
      />,
    );
    expect((marker(container) as HTMLElement).style.insetInlineStart).toBe("50%");
  });

  it("hides the rule from a screen reader", () => {
    const { container } = render(
      <ProgressBar label={LABEL} value={62} valueLabel="62%" target={80} targetLabel={TARGET_LABEL} />,
    );
    // Announcing it would be a shape with no name. The sentence is the mark.
    expect(marker(container)).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the label as text", () => {
    render(
      <ProgressBar label={LABEL} value={62} valueLabel="62%" target={80} targetLabel={TARGET_LABEL} />,
    );
    expect(screen.getByText(TARGET_LABEL)).toBeVisible();
  });

  it("hands the label to the bar as its description", () => {
    render(
      <ProgressBar label={LABEL} value={62} valueLabel="62%" target={80} targetLabel={TARGET_LABEL} />,
    );
    expect(screen.getByRole("progressbar", { name: LABEL })).toHaveAccessibleDescription(
      TARGET_LABEL,
    );
  });

  it("leaves the value reading as the value", () => {
    render(
      <ProgressBar label={LABEL} value={62} valueLabel="62%" target={80} targetLabel={TARGET_LABEL} />,
    );
    // The threshold is a description, not part of the number. Folding it into
    // aria-valuetext would make "62%" read differently depending on whether a
    // second, unrelated figure happened to be passed.
    expect(screen.getByRole("progressbar", { name: LABEL })).toHaveAttribute(
      "aria-valuetext",
      "62%",
    );
  });
});

describe("never colour alone", () => {
  it("refuses a target with no label in development", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ProgressBar label={LABEL} value={62} valueLabel="62%" target={80} />);
    // A rule standing at 80% with nothing naming it is a mark the reader has to
    // guess at — §09.2, the same rule that makes StatusBadge carry a word.
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toContain("must be named");
  });

  it("refuses it even where the mark would not be drawn, because the bug is the same", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ProgressBar label={LABEL} value={62} valueLabel="62%" target={0} />);
    expect(error).toHaveBeenCalledOnce();
  });

  it("is satisfied by a label", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ProgressBar label={LABEL} value={62} valueLabel="62%" target={80} targetLabel={TARGET_LABEL} />,
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("asks nothing of a bar with no target at all", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ProgressBar label={LABEL} value={62} valueLabel="62%" />);
    expect(error).not.toHaveBeenCalled();
  });
});
