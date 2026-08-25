import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Alert } from "@/components/display/Alert";

/**
 * Component 65, and the one rule the inventory states outright: a notice
 * describing a problem must also carry the action that fixes it.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the tone is carried by the copy, not an icon", () => {
  it("renders no image, icon or graphic", () => {
    const { container } = render(<Alert tone="bad" fix="Try again.">That file could not be read.</Alert>);
    // An icon is a second channel saying the same thing to people who can
    // already read the sentence, and nothing to the ones who cannot.
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("offers all five tones", () => {
    for (const tone of ["ok", "warn", "bad", "info", "neutral"] as const) {
      const { container, unmount } = render(
        <Alert tone={tone} fix="A fix.">
          A notice.
        </Alert>,
      );
      expect(container.firstElementChild, tone).not.toBeNull();
      unmount();
    }
  });
});

describe("a problem carries its fix", () => {
  it("complains in development when a bad notice has neither action nor fix", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<Alert tone="bad">Something went wrong.</Alert>);
    // "Something went wrong" is not a notice, it is an apology.
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toContain("must carry the action that fixes it");
  });

  it("complains for warn too", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<Alert tone="warn">Your licence expires soon.</Alert>);
    expect(error).toHaveBeenCalledOnce();
  });

  it("is satisfied by a written fix", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <Alert tone="bad" fix="Use 24-hour times like 08:00.">
        &quot;8am&quot; is not a time.
      </Alert>,
    );
    expect(error).not.toHaveBeenCalled();
    expect(screen.getByText(/24-hour times/)).toBeInTheDocument();
  });

  it("is satisfied by an action", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <Alert tone="bad" action={<button type="button">Reload</button>}>
        That page has changed since you opened it.
      </Alert>,
    );
    expect(error).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("asks nothing of the tones that are not problems", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const tone of ["ok", "info", "neutral"] as const) {
      const { unmount } = render(<Alert tone={tone}>Saved.</Alert>);
      unmount();
    }
    expect(error).not.toHaveBeenCalled();
  });
});

describe("how it announces itself", () => {
  it("interrupts for a failure the reader just caused", () => {
    render(
      <Alert tone="bad" live="assertive" fix="Choose a name column.">
        No column holds the product name.
      </Alert>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("waits for a pause on a confirmation", () => {
    render(
      <Alert tone="ok" live="polite">
        Saved and live.
      </Alert>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("says nothing at all when it was on the page first", () => {
    // Announcing static content on load is noise, not access.
    render(<Alert tone="info">Free is a plan, not a trial.</Alert>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("one action, never two", () => {
  it("takes a single action node", () => {
    // A notice offering a choice is a dialog wearing a notice's clothes, and
    // belongs in a Modal where the choice can be read before either half is
    // clicked. The prop is one node; this is the shape, not a runtime check.
    render(
      <Alert tone="warn" action={<button type="button">Undo</button>}>
        5 products imported.
      </Alert>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
