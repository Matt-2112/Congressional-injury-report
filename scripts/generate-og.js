// Social share cards: one 1200×630 PNG per member plus a tiny /m/<id>.html
// page carrying the Open Graph tags (crawlers don't run JS, so the SPA-style
// member.html can't serve per-member previews). Cards omit volatile stats
// (attendance %) so bytes only change when a grade or status changes.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { ROOT, log } from "./lib.js";

const OG_DIR = path.join(ROOT, "site", "og");
const M_DIR = path.join(ROOT, "site", "m");

const NAVY = "#0e2144";
const NAVY_EDGE = "#0a1730";
const GOLD = "#d4af5a";
const CREAM = "#faf7ee";
const CREAM_DIM = "rgba(244,239,227,0.72)";
const STATUS_COLORS = { OUT: "#e06c6c", DOUBTFUL: "#e0925f", QUESTIONABLE: "#d4af5a", PROBABLE: "#7fbd8b" };

GlobalFonts.registerFromPath(path.join(ROOT, "scripts/og-assets/PlayfairDisplay.ttf"), "Playfair");
GlobalFonts.registerFromPath(path.join(ROOT, "scripts/og-assets/LibreFranklin.ttf"), "Franklin");

async function siteBase() {
  try {
    const domain = (await readFile(path.join(ROOT, "site", "CNAME"), "utf8")).trim();
    return `https://${domain}`;
  } catch {
    return "";
  }
}

function drawFrame(ctx, W, H) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, NAVY);
  grad.addColorStop(1, NAVY_EDGE);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.strokeRect(26, 26, W - 52, H - 52);
  ctx.lineWidth = 1;
  ctx.strokeRect(34, 34, W - 68, H - 68);
}

function kicker(ctx, text, x, y, { align = "left" } = {}) {
  ctx.font = "600 22px Franklin";
  ctx.fillStyle = GOLD;
  ctx.textAlign = align;
  ctx.fillText(text.toUpperCase().split("").join("  "), x, y);
}

function fitText(ctx, text, maxWidth, px, font) {
  let size = px;
  do {
    ctx.font = `700 ${size}px ${font}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  } while (size > 30);
  return size;
}

function memberCard(m) {
  const W = 1200;
  const H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawFrame(ctx, W, H);

  kicker(ctx, "The Congressional Injury Report", 80, 118);

  // Name (shrink to fit the space left of the grade seal)
  const nameMax = 720;
  const size = fitText(ctx, m.name, nameMax, 72, "Playfair");
  ctx.fillStyle = CREAM;
  ctx.textAlign = "left";
  ctx.font = `700 ${size}px Playfair`;
  ctx.fillText(m.name, 80, 118 + 46 + size);

  // Seat line
  const seat = m.chamber === "senate"
    ? `${m.party}-${m.state} · United States Senate`
    : `${m.party}-${m.state}${m.district ? "-" + m.district : ""} · House of Representatives`;
  ctx.font = "600 26px Franklin";
  ctx.fillStyle = CREAM_DIM;
  ctx.fillText([m.title, seat].filter(Boolean).join(" · ").toUpperCase(), 80, 118 + 46 + size + 52);

  // Status line (only when listed)
  if (m.status) {
    const color = STATUS_COLORS[m.status.status] ?? GOLD;
    ctx.font = "700 30px Franklin";
    ctx.fillStyle = color;
    const label = m.status.status;
    ctx.fillText(label, 80, 470);
    const lw = ctx.measureText(label).width;
    if (m.status.reason) {
      ctx.font = "600 30px Franklin";
      ctx.fillStyle = CREAM_DIM;
      ctx.fillText(`  —  ${m.status.reason}`, 80 + lw, 470);
    }
  }

  // Grade seal (right side)
  const cx = 985;
  const cy = 315;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, 128, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 118, 0, Math.PI * 2);
  ctx.stroke();
  const poor = m.session.grade === "F" || m.session.grade === "D";
  ctx.fillStyle = poor ? "#e06c6c" : CREAM;
  ctx.font = "700 130px Playfair";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(m.session.grade, cx, cy + 8);
  ctx.textBaseline = "alphabetic";
  ctx.font = "600 20px Franklin";
  ctx.fillStyle = GOLD;
  ctx.fillText("ATTENDANCE GRADE", cx, cy + 178);

  // Footer
  ctx.textAlign = "center";
  ctx.font = "600 22px Franklin";
  ctx.fillStyle = CREAM_DIM;
  ctx.fillText("congressinjuryreport.com", W / 2, H - 62);

  return canvas.toBuffer("image/png");
}

function siteCard() {
  const W = 1200;
  const H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawFrame(ctx, W, H);
  kicker(ctx, "United States Congress · Daily Attendance Register", W / 2, 200, { align: "center" });
  ctx.fillStyle = CREAM;
  ctx.textAlign = "center";
  ctx.font = "700 88px Playfair";
  ctx.fillText("The Congressional", W / 2, 330);
  ctx.fillStyle = GOLD;
  ctx.font = "italic 700 88px Playfair";
  ctx.fillText("Injury Report", W / 2, 430);
  ctx.font = "600 24px Franklin";
  ctx.fillStyle = CREAM_DIM;
  ctx.fillText("Who's out, who's questionable, and why — updated daily", W / 2, 500);
  return canvas.toBuffer("image/png");
}

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function memberPage(m, base) {
  const grade = m.session.grade;
  const title = `${m.name} — ${grade} | Congressional Injury Report`;
  const desc = m.status
    ? `${m.status.status}${m.status.reason ? " — " + m.status.reason : ""}. ${m.session.pct}% attendance this session (${m.session.missed} votes missed).`
    : `${m.session.pct === null ? "New this session" : m.session.pct + "% attendance this session"} — ranked ${m.session.rank ?? "—"} of ${m.session.of ?? "—"} in the ${m.chamber === "senate" ? "Senate" : "House"}.`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${escAttr(title)}</title>
<meta property="og:title" content="${escAttr(`${m.name}: ${grade}`)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:image" content="${base}/og/${m.bioguide}.png">
<meta property="og:url" content="${base}/m/${m.bioguide}.html">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="Congressional Injury Report">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${base}/m/${m.bioguide}.html">
<meta http-equiv="refresh" content="0;url=/member.html?m=${m.bioguide}">
</head><body>
<p><a href="/member.html?m=${m.bioguide}">${escAttr(m.name)} — attendance report card</a></p>
</body></html>
`;
}

// Write only when bytes changed, so unchanged cards don't churn git mtimes.
async function writeIfChanged(file, buf) {
  const prev = await readFile(file).catch(() => null);
  if (prev && Buffer.compare(prev, Buffer.from(buf)) === 0) return false;
  await writeFile(file, buf);
  return true;
}

export async function generateOg(memberStats) {
  await mkdir(OG_DIR, { recursive: true });
  await mkdir(M_DIR, { recursive: true });
  const base = await siteBase();

  let changed = 0;
  for (const m of memberStats.members) {
    if (await writeIfChanged(path.join(OG_DIR, `${m.bioguide}.png`), memberCard(m))) changed++;
    await writeIfChanged(path.join(M_DIR, `${m.bioguide}.html`), Buffer.from(memberPage(m, base)));
  }
  await writeIfChanged(path.join(OG_DIR, "site.png"), siteCard());
  log("og", `${memberStats.members.length} share cards (${changed} changed)`);
}
