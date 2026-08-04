export function isSourceNetworkDisabled(publicConfig: unknown) {
  return (
    typeof publicConfig === "object" &&
    publicConfig !== null &&
    "networkDisabled" in publicConfig &&
    publicConfig.networkDisabled === true
  );
}
