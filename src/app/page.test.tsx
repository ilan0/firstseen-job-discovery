import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("states the product purpose", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: "Good jobs, while they are still fresh." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Official listings")).toBeInTheDocument();
  });
});
