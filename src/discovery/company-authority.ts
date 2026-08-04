import { load } from "cheerio";
import { safeGet } from "@/connectors/http";

export type CompanyAuthority = {
  companyName: string;
  confidence: number;
  evidence: { kind: "official_ats_page"; sourceUrl: string };
};

const genericNames = new Set(["jobs", "careers", "job board", "open positions", "greenhouse"]);

export function authorityNameFromHtml(html: string): string | null {
  const $ = load(html);
  const candidates = [
    $('meta[property="og:site_name"]').attr("content"),
    $('meta[property="og:title"]').attr("content"),
    $("title").first().text(),
    $("h1").first().text(),
  ];
  for (const candidate of candidates) {
    const name = candidate
      ?.replace(/\s+/g, " ")
      .replace(/^(jobs|careers|open positions)\s+(at|with)\s+/i, "")
      .replace(/\s*[|–—-]\s*(jobs|careers|greenhouse|lever|ashby|recruitee|pinpoint).*$/i, "")
      .replace(/\s+(jobs|careers)$/i, "")
      .trim();
    if (name && name.length >= 2 && name.length <= 160 && !genericNames.has(name.toLowerCase()))
      return name;
  }
  return null;
}

export async function verifyCompanyAuthority(
  officialIndex: string,
): Promise<CompanyAuthority | null> {
  const response = await safeGet(officialIndex, {
    timeoutMs: 8_000,
    maximumBytes: 512 * 1024,
    maximumRedirects: 3,
    allowedContentTypes: ["text/html", "text/plain"],
  });
  if (response.status < 200 || response.status >= 400) return null;
  const companyName = authorityNameFromHtml(response.text());
  return companyName
    ? {
        companyName,
        confidence: 85,
        evidence: { kind: "official_ats_page", sourceUrl: response.url },
      }
    : null;
}
