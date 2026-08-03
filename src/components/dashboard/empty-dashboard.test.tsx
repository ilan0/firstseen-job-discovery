import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyDashboard } from "./empty-dashboard";

describe("EmptyDashboard", () => {
  it("explains how job discovery starts", () => {
    render(<EmptyDashboard />);

    expect(
      screen.getByRole("heading", { name: "Good jobs, while they are still fresh." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add companies" })).toBeInTheDocument();
  });
});
