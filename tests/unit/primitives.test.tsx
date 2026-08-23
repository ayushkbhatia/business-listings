import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  Button,
  Checkbox,
  FileDrop,
  IconButton,
  Radio,
  RadioGroup,
  SegmentedControl,
  Stepper,
  TimePair,
  Toggle,
} from "@/components/primitives";

/**
 * These cover the behaviours that are invisible in a screenshot and easy to
 * regress: the accessible name, the keyboard path, and the one state that is a
 * DOM property rather than an attribute.
 */

describe("Button", () => {
  it("is busy rather than merely disabled while loading", () => {
    render(<Button loading>Send quote</Button>);
    const button = screen.getByRole("button", { name: /send quote/i });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
  });

  it("keeps its label while loading, so the user can see what they clicked", () => {
    render(<Button loading>Send quote</Button>);
    expect(screen.getByRole("button", { name: /send quote/i })).toBeVisible();
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Send quote
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"), { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("IconButton", () => {
  it("takes its accessible name from the required label", () => {
    render(<IconButton label="More actions" icon={<span />} />);
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
  });

  it("uses the same string as the tooltip, so sighted users get it too", () => {
    render(<IconButton label="More actions" icon={<span />} />);
    expect(screen.getByRole("button")).toHaveAttribute("title", "More actions");
  });
});

describe("Checkbox", () => {
  it("sets indeterminate on the node — it is a property, not an attribute", () => {
    render(<Checkbox label="Select all" indeterminate />);
    const box = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
  });

  it("is togglable by clicking its label", async () => {
    render(<Checkbox label="Publish this listing" />);
    await userEvent.click(screen.getByText("Publish this listing"));
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});

describe("Toggle", () => {
  it("announces as a switch, not a checkbox", () => {
    render(<Toggle checked onChange={() => {}} label="WhatsApp updates" />);
    expect(screen.getByRole("switch", { name: "WhatsApp updates" })).toBeInTheDocument();
  });

  it("has an accessible name even though a label cannot bind to a button", () => {
    // <label for> only binds to labelable elements. A button is not one, so the
    // name has to come from aria-labelledby.
    render(<Toggle checked={false} onChange={() => {}} label="Publish this listing" />);
    expect(screen.getByRole("switch", { name: "Publish this listing" })).toBeInTheDocument();
  });

  it("is busy and not clickable while pending", async () => {
    const onChange = vi.fn();
    render(<Toggle checked pending onChange={onChange} label="WhatsApp updates" />);
    const control = screen.getByRole("switch");
    expect(control).toHaveAttribute("aria-busy", "true");
    await userEvent.click(control, { pointerEventsCheck: 0 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SegmentedControl", () => {
  it("is one tab stop, and arrow keys move inside it", async () => {
    function Harness() {
      const [value, setValue] = useState("businesses");
      return (
        <SegmentedControl
          label="Results"
          value={value}
          onChange={setValue}
          options={[
            { value: "businesses", label: "Businesses" },
            { value: "products", label: "Products" },
          ]}
        />
      );
    }
    render(<Harness />);

    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Businesses" })).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Products" })).toBeChecked();
  });

  it("skips a disabled option when arrowing", async () => {
    function Harness() {
      const [value, setValue] = useState("a");
      return (
        <SegmentedControl
          label="Terms"
          value={value}
          onChange={setValue}
          options={[
            { value: "a", label: "Advance" },
            { value: "b", label: "Thirty days", disabled: true },
            { value: "c", label: "Letter of credit" },
          ]}
        />
      );
    }
    render(<Harness />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Letter of credit" })).toBeChecked();
  });
});

describe("RadioGroup", () => {
  it("wraps its radios in a named group", () => {
    render(
      <RadioGroup legend="Payment terms">
        <Radio name="t" value="a" label="Advance" />
        <Radio name="t" value="b" label="Thirty days" />
      </RadioGroup>,
    );
    expect(screen.getByRole("group", { name: "Payment terms" })).toBeInTheDocument();
  });
});

describe("Stepper", () => {
  it("stops at its bounds rather than silently doing nothing", async () => {
    const onChange = vi.fn();
    render(
      <Stepper
        value={1}
        min={1}
        max={3}
        onChange={onChange}
        label="Quantity"
        decrementLabel="Decrease quantity"
        incrementLabel="Increase quantity"
      />,
    );
    expect(screen.getByRole("button", { name: "Decrease quantity" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("lets a buyer type a large quantity instead of clicking", async () => {
    function Harness() {
      const [value, setValue] = useState(1);
      return (
        <Stepper
          value={value}
          onChange={setValue}
          label="Quantity"
          decrementLabel="Decrease quantity"
          incrementLabel="Increase quantity"
        />
      );
    }
    render(<Harness />);
    const field = screen.getByRole("spinbutton", { name: "Quantity" });
    await userEvent.clear(field);
    await userEvent.type(field, "240");
    // 240 valves is a real enquiry line. Nobody presses + two hundred times.
    expect(field).toHaveValue(240);
  });
});

describe("TimePair", () => {
  it("flags a close at or before its open", () => {
    render(
      <TimePair
        open="16:00"
        close="09:00"
        onChange={() => {}}
        openLabel="Opens at"
        closeLabel="Closes at"
        orderErrorLabel="Closing time must be later than opening time"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/later than opening/i);
    expect(screen.getByLabelText("Closes at")).toHaveAttribute("aria-invalid", "true");
  });

  it("says nothing when the pair is in order", () => {
    render(
      <TimePair
        open="08:00"
        close="13:00"
        onChange={() => {}}
        openLabel="Opens at"
        closeLabel="Closes at"
        orderErrorLabel="Closing time must be later than opening time"
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("FileDrop", () => {
  it("is dashed only while idle — a dashed border means empty", () => {
    const { container, rerender } = render(<FileDrop state="idle" idleLabel="Drop a file" />);
    expect(container.querySelector(".border-dashed")).not.toBeNull();

    rerender(<FileDrop state="done" filename="licence.pdf" idleLabel="Drop a file" />);
    expect(container.querySelector(".border-dashed")).toBeNull();
  });

  it("reports upload progress to assistive technology", () => {
    render(
      <FileDrop
        state="uploading"
        progress={62}
        filename="licence.pdf"
        uploadingLabel="Uploading"
        idleLabel="Drop a file"
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Uploading" });
    expect(bar).toHaveAttribute("aria-valuenow", "62");
  });

  it("announces a failure and offers the way out", () => {
    render(
      <FileDrop
        state="error"
        filename="photos.zip"
        errorMessage="That file is 24 MB. The limit is 10 MB."
        retryLabel="Try again"
        idleLabel="Drop a file"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/limit is 10 MB/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("keeps the hidden input out of the tab order", () => {
    const { container } = render(<FileDrop state="idle" idleLabel="Drop a file" />);
    const input = container.querySelector('input[type="file"]');
    expect(input).toHaveAttribute("aria-hidden", "true");
    expect(input).toHaveAttribute("tabindex", "-1");
  });
});
