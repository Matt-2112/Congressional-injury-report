// Daily digest to Bluesky. Posts one summary per report date with the site
// share card, via raw AT Protocol XRPC (no SDK dependency). Outward-facing and
// idempotent: it skips when credentials are absent (local runs never post) and
// dedupes on report date so a re-run can't double-post.
//
// Setup: create a Bluesky handle for the bot, generate an App Password
// (Settings → App Passwords — NOT the account password), and set
// BLUESKY_IDENTIFIER (the handle or email) + BLUESKY_APP_PASSWORD.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { ROOT, DATA_DIR, log, writeJson } from "./lib.js";

const PDS = "https://bsky.social";
const SITE_URL = "https://congressinjuryreport.com";
const STORE = path.join(DATA_DIR, "social-store.json");

const utf8 = (s) => Buffer.byteLength(s, "utf8");
const fmtDate = (iso) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Compose the digest text (kept well under Bluesky's 300-grapheme limit) plus a
// link facet so the URL is tappable — Bluesky does not auto-link bare URLs.
function composeDigest(report) {
  const count = (ch, st) => ch.listed.filter((e) => e.status === st).length;
  const h = report.chambers.house;
  const s = report.chambers.senate;

  // Most recent "absence that mattered" across chambers, if any.
  const close = [...(h.closeCalls || []), ...(s.closeCalls || [])]
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const lines = [
    `🏛️ Congressional Injury Report · ${fmtDate(report.reportDate)}`,
    "",
    `House: ${count(h, "OUT")} out, ${count(h, "IR")} on IR`,
    `Senate: ${count(s, "OUT")} out, ${count(s, "IR")} on IR`,
  ];
  if (close) {
    const q = close.question.length > 70 ? close.question.slice(0, 67) + "…" : close.question;
    const marg = close.margin === 0 ? "a tie" : `${close.margin} vote${close.margin === 1 ? "" : "s"}`;
    lines.push("", `Closest call: ${[close.legisNum, q].filter(Boolean).join(" — ")} (${marg}, ${close.absent} out)`);
  }
  lines.push("", `Who's showing up → ${SITE_URL}`);

  let text = lines.join("\n");
  // Safety net: if the optional close-call line pushes us near the limit, drop it.
  if ([...text].length > 295 && close) {
    text = [lines[0], "", lines[2], lines[3], "", `Who's showing up → ${SITE_URL}`].join("\n");
  }

  const at = text.indexOf(SITE_URL);
  const facets = at >= 0
    ? [{
        index: { byteStart: utf8(text.slice(0, at)), byteEnd: utf8(text.slice(0, at)) + utf8(SITE_URL) },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: SITE_URL + "/" }],
      }]
    : [];
  return { text, facets };
}

async function xrpc(method, { jwt, json, body, contentType } = {}) {
  const res = await fetch(`${PDS}/xrpc/${method}`, {
    method: "POST",
    headers: {
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      "content-type": contentType || "application/json",
    },
    body: json ? JSON.stringify(json) : body,
  });
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

export async function postSocial(report, { dryRun = false } = {}) {
  // Idempotency: one post per report date, tracked in a committed store.
  let store = null;
  try { store = JSON.parse(await readFile(STORE, "utf8")); } catch { /* first run */ }
  if (store?.lastPostedDate === report.reportDate) {
    log("social", `already posted for ${report.reportDate}`);
    return { posted: false, reason: "duplicate" };
  }

  const { text, facets } = composeDigest(report);
  const id = process.env.BLUESKY_IDENTIFIER;
  const pw = process.env.BLUESKY_APP_PASSWORD;

  if (dryRun || !id || !pw) {
    log("social", `${dryRun ? "DRY RUN" : "no BLUESKY credentials — skipping"}; would post:\n${text}`);
    return { posted: false, reason: dryRun ? "dry-run" : "no-credentials", text, facets };
  }

  const { accessJwt, did } = await xrpc("com.atproto.server.createSession", { json: { identifier: id, password: pw } });

  // Attach the site share card when available; a missing image never blocks the post.
  let embed;
  try {
    const png = await readFile(path.join(ROOT, "site", "og", "site.png"));
    const { blob } = await xrpc("com.atproto.repo.uploadBlob", { jwt: accessJwt, body: png, contentType: "image/png" });
    embed = {
      $type: "app.bsky.embed.images",
      images: [{ image: blob, alt: "The Congressional Injury Report — daily attendance register for the House and Senate." }],
    };
  } catch (err) {
    log("social", `image skipped: ${err.message}`);
  }

  const record = {
    $type: "app.bsky.feed.post",
    text,
    facets,
    langs: ["en"],
    createdAt: new Date().toISOString(),
    ...(embed ? { embed } : {}),
  };
  const res = await xrpc("com.atproto.repo.createRecord", {
    jwt: accessJwt,
    json: { repo: did, collection: "app.bsky.feed.post", record },
  });

  await writeJson(STORE, { lastPostedDate: report.reportDate, postedAt: new Date().toISOString(), uri: res.uri });
  log("social", `posted digest for ${report.reportDate} → ${res.uri}`);
  return { posted: true, uri: res.uri, text };
}
