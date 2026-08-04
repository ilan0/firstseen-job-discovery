import { describe, expect, it } from "vitest";
import { htmlToText, requiredTenant } from "./normalize";

describe("connector normalization", () => {
  it("accepts a dotted public ATS tenant without accepting path syntax", () => {
    const source = {
      id: "source",
      kind: "lever" as const,
      companyName: "Jito",
      baseUrl: "https://jobs.lever.co/jito.wtf",
      tenantId: "jito.wtf",
    };
    expect(requiredTenant(source)).toBe("jito.wtf");
    expect(() => requiredTenant({ ...source, tenantId: "../private" })).toThrow(
      expect.objectContaining({ code: "INVALID_TENANT" }),
    );
  });
  it("turns ordinary HTML into readable text and drops executable content", () => {
    expect(
      htmlToText("<h2>Requirements</h2><script>ignore()</script><ul><li>Build APIs</li></ul>"),
    ).toBe("Requirements\nBuild APIs");
  });

  it("parses entity-encoded Greenhouse markup instead of exposing visible tags", () => {
    expect(
      htmlToText(
        "&lt;h2&gt;Requirements&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;5+ years of engineering experience&lt;/li&gt;&lt;/ul&gt;",
      ),
    ).toBe("Requirements\n5+ years of engineering experience");
  });

  it("preserves plain-text comparisons rather than interpreting them as markup", () => {
    expect(htmlToText("Use x < y and return plain text.")).toBe("Use x < y and return plain text.");
  });
});
