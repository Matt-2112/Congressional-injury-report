// Shared helpers for the data pipeline.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.join(ROOT, "data");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const SITE_DATA_DIR = path.join(ROOT, "site", "data");

// senate.gov and house.gov 403 default fetch user agents.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  trimValues: true,
});

// Backoff schedule leans long: clerk.house.gov rate-limits bursts from
// datacenter IPs (GitHub Actions) with 403s whose cool-down can run minutes.
// CI time is cheap; a slow green run beats a fast red one.
const BACKOFF_MS = [2000, 10000, 30000, 90000, 180000];

export async function fetchText(url, { retries = BACKOFF_MS.length, allow404 = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 404 && allow404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      if (attempt >= retries) throw err;
      const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      await new Promise((r) => setTimeout(r, base + Math.random() * 1000));
    }
  }
}

// Fetch with an on-disk cache. Roll-call XML is immutable once published, so
// cached files are trusted forever; pass maxAgeMs for sources that change.
export async function fetchCached(url, cacheKey, { maxAgeMs = Infinity, allow404 = false } = {}) {
  const file = path.join(CACHE_DIR, cacheKey);
  if (existsSync(file)) {
    const { mtimeMs } = await import("node:fs").then((fs) => fs.promises.stat(file));
    if (Date.now() - mtimeMs < maxAgeMs) return readFile(file, "utf8");
  }
  const text = await fetchText(url, { allow404 });
  if (text === null) return null;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return text;
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

export function asArray(x) {
  return x === undefined || x === null ? [] : Array.isArray(x) ? x : [x];
}

// "6-Jan-2026" or "June 24, 2026,  10:30 PM" → "2026-01-06"
export function toIsoDate(s) {
  const d = new Date(String(s).replace(/,\s+/g, ", "));
  if (Number.isNaN(d.getTime())) throw new Error(`Unparseable date: ${s}`);
  return d.toISOString().slice(0, 10);
}

export function todayIso() {
  // Report dates in US Eastern time, where Congress lives.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// Congress number and session for a given year: 119th = 2025–26.
export function congressForYear(year) {
  const congress = Math.floor((year - 1789) / 2) + 1;
  const session = year % 2 === 1 ? 1 : 2;
  return { congress, session };
}

export function log(step, msg) {
  console.log(`[${step}] ${msg}`);
}

// Map with bounded concurrency — hundreds of small XML fetches would be slow
// serially and rude in parallel.
export async function pMap(items, fn, concurrency = 8) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
