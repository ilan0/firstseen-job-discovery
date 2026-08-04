import { load } from "cheerio";
import { safeGet } from "@/connectors/http";

export type CompanyAuthority = {
  companyName: string;
  canonicalDomain: string | null;
  confidence: number;
  evidence: { kind: "official_ats_page"; sourceUrl: string; canonicalDomain: string | null };
};

const genericNames = new Set(["jobs", "careers", "job board", "open positions", "greenhouse"]);
const atsHosts = ["greenhouse.io", "lever.co", "ashbyhq.com", "recruitee.com", "pinpointhq.com"];
const nonEmployerHosts = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "youtube.com",
];

function normalizedHostname(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isHostOrSubdomain(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function canonicalEmployerDomainFromHtml(html: string, sourceUrl: string): string | null {
  const $ = load(html);
  const candidates = $("a[href]")
    .toArray()
    .map((element) => {
      const href = $(element).attr("href");
      const text = $(element).text().replace(/\s+/g, " ").trim().toLowerCase();
      const host = href ? normalizedHostname(href, sourceUrl) : null;
      if (!host) return null;
      if ([...atsHosts, ...nonEmployerHosts].some((domain) => isHostOrSubdomain(host, domain)))
        return null;
      if (/\b(?:privacy|terms|legal|support|help|cookie)\b/i.test(text)) return null;
      const score = /\b(?:company|website|home|about)\b/i.test(text) ? 2 : 1;
      return { host, score };
    })
    .filter((candidate): candidate is { host: string; score: number } => candidate !== null)
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.host ?? null;
}

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
  const html = response.text();
  const companyName = authorityNameFromHtml(html);
  const canonicalDomain = canonicalEmployerDomainFromHtml(html, response.url);
  return companyName
    ? {
        companyName,
        canonicalDomain,
        confidence: 85,
        evidence: { kind: "official_ats_page", sourceUrl: response.url, canonicalDomain },
      }
    : null;
}
