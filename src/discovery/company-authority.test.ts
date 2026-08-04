import { describe, expect, it } from "vitest";
import { authorityNameFromHtml, canonicalEmployerDomainFromHtml } from "./company-authority";

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

  it("extracts an external employer domain without mistaking ATS or social links for authority", () => {
    const html = `
      <a href="https://boards.greenhouse.io/acme">Jobs</a>
      <a href="https://linkedin.com/company/acme">LinkedIn</a>
      <a href="https://www.acme.example/about">Company website</a>
    `;
    expect(canonicalEmployerDomainFromHtml(html, "https://boards.greenhouse.io/acme")).toBe(
      "acme.example",
    );
  });

  it("does not invent a domain when the ATS page has no employer-owned link", () => {
    expect(
      canonicalEmployerDomainFromHtml(
        '<a href="https://jobs.lever.co/acme">Open roles</a>',
        "https://jobs.lever.co/acme",
      ),
    ).toBeNull();
  });
});
