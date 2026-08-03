import { ConnectorError } from "./errors";
import type { DiscoveryPage, JobConnector, VerificationResult } from "./types";
import { connectorVersions, type ConnectorKind } from "./versions";

export class UnsupportedConnector implements JobConnector {
  readonly version: string;

  constructor(
    readonly kind: ConnectorKind,
    private readonly rationale: string,
  ) {
    this.version = connectorVersions[kind];
  }

  async discover(): Promise<DiscoveryPage> {
    throw new ConnectorError("SOURCE_UNSUPPORTED", this.rationale, false);
  }

  async verify(): Promise<VerificationResult> {
    return { state: "uncertain", evidence: this.rationale };
  }
}
