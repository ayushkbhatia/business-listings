import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorState } from "@/app/_error/ErrorState";
import { en } from "@/lib/i18n";

describe("ErrorState — the unplanned error (build plan 9.2)", () => {
  it("names whose fault it is and carries the reference when the server gave one", () => {
    render(<ErrorState digest="2718281828" action={<button type="button">Try again</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "This page did not load" })).toBeInTheDocument();
    expect(screen.getByText("Something failed on our side, not yours. Trying again usually works.")).toBeInTheDocument();
    expect(screen.getByText("Reference 2718281828")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows no reference block for an error thrown in the browser", () => {
    render(<ErrorState action={null} />);
    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument();
  });

  it("never borrows the maintenance page's claim of planned work", () => {
    const copy = Object.entries(en)
      .filter(([key]) => key.startsWith("errorpage."))
      .map(([, value]) => String(value));
    expect(copy.join(" ")).not.toMatch(/planned|maintenance|back at/i);
  });
});
