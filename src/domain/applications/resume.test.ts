import { describe, expect, it } from "vitest";
import { detectResumeMime, MAX_RESUME_BYTES, safeResumeFilename } from "./resume";

describe("private resume validation", () => {
  it("detects supported formats by magic bytes rather than filename", () => {
    expect(detectResumeMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(detectResumeMime(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toContain(
      "wordprocessingml",
    );
    expect(
      detectResumeMime(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toBe("application/msword");
    expect(detectResumeMime(new TextEncoder().encode("<script>bad()</script>"))).toBeNull();
  });

  it("sanitizes names and retains the five-megabyte server limit", () => {
    expect(safeResumeFilename("../../Ilan Resume (final).pdf")).toBe(
      "..-..-Ilan-Resume-final-.pdf",
    );
    expect(safeResumeFilename("🔥")).toBe("-");
    expect(MAX_RESUME_BYTES).toBe(5_242_880);
  });
});
