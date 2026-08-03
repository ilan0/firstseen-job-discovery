export class ConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export function safeConnectorError(error: unknown): {
  errorCode: string;
  safeMessage: string;
  retryable: boolean;
} {
  if (error instanceof ConnectorError) {
    return { errorCode: error.code, safeMessage: error.message, retryable: error.retryable };
  }
  return {
    errorCode: "UNEXPECTED_CONNECTOR_ERROR",
    safeMessage: "The source failed unexpectedly.",
    retryable: true,
  };
}
