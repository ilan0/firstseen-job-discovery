import {
  AshbyConnector,
  GreenhouseConnector,
  LeverConnector,
  PinpointConnector,
  RecruiteeConnector,
  ReviewedFeedConnector,
  ReviewedSitemapConnector,
} from "./official";
import { JsonLdConnector } from "./official/jsonld";
import type { JobConnector } from "./types";
import { UnsupportedConnector } from "./unsupported";
import type { ConnectorKind } from "./versions";

const connectors = new Map<ConnectorKind, JobConnector>([
  ["greenhouse", new GreenhouseConnector()],
  ["lever", new LeverConnector()],
  ["ashby", new AshbyConnector()],
  ["recruitee", new RecruiteeConnector()],
  ["pinpoint", new PinpointConnector()],
  ["custom_jsonld", new JsonLdConnector()],
  ["custom_feed", new ReviewedFeedConnector()],
  ["custom_sitemap", new ReviewedSitemapConnector()],
  [
    "smartrecruiters",
    new UnsupportedConnector(
      "smartrecruiters",
      "SmartRecruiters Posting API requires a legitimate API key.",
    ),
  ],
  [
    "workday",
    new UnsupportedConnector(
      "workday",
      "This Workday tenant needs an approved public adapter or JSON-LD source.",
    ),
  ],
  [
    "icims",
    new UnsupportedConnector(
      "icims",
      "This iCIMS source needs authorized API access or a public JSON-LD page.",
    ),
  ],
  [
    "jobvite",
    new UnsupportedConnector(
      "jobvite",
      "This Jobvite source needs an authorized feed or public JSON-LD page.",
    ),
  ],
  [
    "custom_html",
    new UnsupportedConnector(
      "custom_html",
      "A reviewed custom parser has not been configured for this employer.",
    ),
  ],
  [
    "unsupported",
    new UnsupportedConnector(
      "unsupported",
      "The employer source is unsupported and requires manual review.",
    ),
  ],
]);

export function connectorFor(kind: ConnectorKind): JobConnector {
  const connector = connectors.get(kind);
  if (!connector) throw new Error(`Connector ${kind} is not registered.`);
  return connector;
}
