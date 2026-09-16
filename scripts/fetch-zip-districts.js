// ZIP → congressional-district crosswalk for the "find my rep" search.
// Source: OpenSourceActivismTech/us-zipcodes-congress (keyless CSV, 2020
// Census ZCTAs matched to the 119th Congress). Emits a compact map:
//   { "32403": ["FL", 2], "35005": ["AL", 6, 7], "99501": ["AK", 0] }
// One entry per ZIP; a ZIP that straddles districts lists each. At-large is 0
// (matching the roster). ~0.5% of ZIPs span two states; we keep the first
// state seen — good enough for a lookup hint, not a legal boundary.
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fetchCached, SITE_DATA_DIR, log } from "./lib.js";

const SRC =
  "https://raw.githubusercontent.com/OpenSourceActivismTech/us-zipcodes-congress/master/zccd.csv";

export async function fetchZipDistricts() {
  // Redistricting is rare; a stale-but-present crosswalk beats a failed run.
  const csv = await fetchCached(SRC, "zccd.csv", { maxAgeMs: 30 * 86400000 });
  if (!csv) throw new Error("zccd.csv unavailable");

  const map = {};
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const [, state, zcta, cd] = lines[i].split(",");
    if (!zcta || !state) continue;
    const district = Number(cd);
    if (Number.isNaN(district)) continue;
    let entry = map[zcta];
    if (!entry) map[zcta] = entry = [state];
    if (!entry.includes(district)) entry.push(district);
  }
  // Sort districts for stable, churn-free output.
  for (const zip in map) {
    const [state, ...districts] = map[zip];
    districts.sort((a, b) => a - b);
    map[zip] = [state, ...districts];
  }

  const out = path.join(SITE_DATA_DIR, "zip-districts.json");
  const json = JSON.stringify(map); // compact — this file is ~1 MB
  const prev = await readFile(out, "utf8").catch(() => null);
  if (prev !== json) await writeFile(out, json);
  log("zip", `${Object.keys(map).length} ZIP codes mapped${prev === json ? " (unchanged)" : ""}`);
  return map;
}
