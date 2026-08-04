import { describe, expect, it } from "vitest";
import { authorityNameFromHtml } from "./company-authority";

describe("ATS hiring-organization authority", () => {
  it.each([
    ["<title>Jobs at Acme Robotics | Greenhouse</title>", "Acme Robotics"],
    [
      '<meta property="og:site_name" content="North Star Labs"><title>Careers</title>',
      "North Star Labs",
    ],
    ["<h1>Careers with Bright Systems</h1>", "Bright Systems"],
  ])("extracts a company from official ATS evidence", (html, expected) => {
    expect(authorityNameFromHtml(html)).toBe(expected);
  });

  it.each(["<title>Jobs</title>", "<title>Greenhouse</title>", "<html></html>"])(
    "rejects generic or absent evidence",
    (html) => expect(authorityNameFromHtml(html)).toBeNull(),
  );
});
