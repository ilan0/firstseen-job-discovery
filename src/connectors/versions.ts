export const connectorVersions = {
  greenhouse: "1.0.0",
  lever: "1.0.0",
  ashby: "1.0.0",
  smartrecruiters: "1.0.0",
  workday: "0.1.0",
  icims: "0.1.0",
  jobvite: "0.1.0",
  custom_jsonld: "1.0.0",
  custom_html: "0.1.0",
  brave: "1.0.0",
  adzuna: "1.0.0",
  unsupported: "1.0.0",
} as const;

export type ConnectorKind = keyof typeof connectorVersions;
