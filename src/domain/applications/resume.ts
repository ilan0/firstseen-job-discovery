export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const RESUME_BUCKET = "firstseen-resumes";

export function detectResumeMime(bytes: Uint8Array): string | null {
  if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (
    bytes.length >= 8 &&
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => bytes[index] === byte)
  )
    return "application/msword";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return null;
}

export function safeResumeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "resume";
}
