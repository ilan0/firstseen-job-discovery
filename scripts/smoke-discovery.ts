import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { resolveOfficialSource } from "@/discovery/resolve-official";
import { AdzunaSensor } from "@/discovery/sensors/adzuna";
import { BraveSensor } from "@/discovery/sensors/brave";

const values = parse(readFileSync(resolve(".env.local"), "utf8"));
const query = {
  roleQuery: '"software engineer I" OR "associate software engineer"',
  locationQuery: "Miami OR Fort Lauderdale",
  remote: false,
};
const checks = [
  new BraveSensor(values.BRAVE_SEARCH_API_KEY ?? ""),
  new AdzunaSensor(values.ADZUNA_APP_ID ?? "", values.ADZUNA_APP_KEY ?? ""),
];
const results = [];
for (const sensor of checks) {
  try {
    const candidates = await sensor.search(query);
    results.push({
      sensor: sensor.kind,
      ok: true,
      candidates: candidates.length,
      directlyResolvableOfficialUrls: candidates.filter((candidate) =>
        resolveOfficialSource(candidate.discoveredUrl),
      ).length,
    });
  } catch (error) {
    const value = error as { code?: string; name?: string; status?: number };
    results.push({
      sensor: sensor.kind,
      ok: false,
      code: value.code ?? value.name ?? "UNKNOWN",
      status: value.status ?? null,
    });
  }
}
console.log(JSON.stringify(results));
if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
