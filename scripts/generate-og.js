// Social share cards: one 1200×630 PNG per member plus a tiny /m/<id>.html
// page carrying the Open Graph tags (crawlers don't run JS, so the SPA-style
// member.html can't serve per-member previews). Cards omit volatile stats
// (attendance %) so bytes only change when a grade or status changes.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { ROOT, log } from "./lib.js";

const SITE_DIR = path.join(ROOT, "site");
const OG_DIR = path.join(SITE_DIR, "og");
const M_DIR = path.join(SITE_DIR, "m");

const NAVY = "#0e2144";
const NAVY_EDGE = "#0a1730";
const GOLD = "#d4af5a";
const CREAM = "#faf7ee";
const CREAM_DIM = "rgba(244,239,227,0.72)";
const STATUS_COLORS = { OUT: "#e06c6c", IR: "#e0925f", QUESTIONABLE: "#d4af5a", PROBABLE: "#7fbd8b" };
// Display labels for statuses whose badge text differs from the internal key.
const STATUS_LABELS = { IR: "Injured Reserve" };
const statusLabel = (s) => STATUS_LABELS[s] ?? s;

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
    const label = statusLabel(m.status.status);
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
const escHtml = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// "2026-06-30" → "Jun 30". Deterministic (UTC noon) so bytes are stable.
const fmtDate = (iso) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : iso;

// The head name is set off with the surname in italic, mirroring member.html.
function splitName(name) {
  const parts = name.split(" ");
  let last = parts.pop();
  if (/^(Jr\.?|Sr\.?|II|III|IV)$/.test(last) && parts.length > 1) last = parts.pop() + " " + last;
  return { first: parts.join(" "), last };
}

function seatLine(m) {
  const seat = m.chamber === "senate"
    ? `${m.party}-${m.state}`
    : `${m.party}-${m.state}${m.district ? "-" + m.district : ""}`;
  const chamberName = m.chamber === "senate" ? "United States Senate" : "House of Representatives";
  return { seat, chamberName };
}

// Full, crawlable report-card page. Server-rendered so search engines and
// social crawlers get real content + structured data (no JS, no redirect);
// search.js still hydrates the "find another member" box for humans.
function memberPage(m, base, sessionYear) {
  const s = m.session;
  const grade = s.grade;
  const { seat, chamberName } = seatLine(m);
  const { first, last } = splitName(m.name);
  const jobTitle = m.title || (m.chamber === "senate" ? "United States Senator" : "United States Representative");

  const title = `${m.name} — ${grade} | Congressional Injury Report`;
  const desc = m.status
    ? `${statusLabel(m.status.status)}${m.status.reason ? " — " + m.status.reason : ""}. ${s.pct}% attendance this session (${s.missed} votes missed).`
    : `${s.pct === null ? "New this session" : s.pct + "% attendance this session"} — ranked ${s.rank ?? "—"} of ${s.of ?? "—"} in the ${m.chamber === "senate" ? "Senate" : "House"}.`;

  const poor = grade === "F" || grade === "D";
  const rank = s.rank ? `${ordinal(s.rank)} of ${s.of}` : "—";
  const pctText = s.pct === null ? "insufficient record" : `${s.pct}% attendance this session`;

  let statusHtml = "";
  if (m.status) {
    let note = escHtml(m.status.note).replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtDate(d));
    note = note.charAt(0).toUpperCase() + note.slice(1);
    const why = m.status.reason
      ? `<span class="reason">${escHtml(m.status.reason)}</span>${m.status.detail ? " — " + escHtml(m.status.detail) : ""}. `
      : "";
    statusHtml = `<p class="rc-status">
      <span class="chip ${escAttr(m.status.status)}">${escHtml(m.status.status)}</span>
      ${why}${note}${m.status.since ? ` (since ${fmtDate(m.status.since)})` : ""}.
    </p>`;
  } else if (s.pct !== null) {
    statusHtml = `<p class="rc-status">Active — no absence flags on the current report.</p>`;
  }
  const speakerHtml = /Speaker/i.test(m.title ?? "")
    ? `<p class="rc-status" style="font-style:italic;font-family:Georgia,serif">By tradition, the Speaker of the House votes at the chair's discretion; presiding days without a recorded position do not count against attendance.</p>`
    : "";

  const ld = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: m.name,
    jobTitle,
    memberOf: { "@type": "GovernmentOrganization", name: chamberName },
    description: desc,
    ...(base ? { url: `${base}/m/${m.bioguide}.html`, image: `${base}/og/${m.bioguide}.png` } : {}),
  };
  const ldJson = JSON.stringify(ld).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escAttr(title)}</title>
<meta name="description" content="${escAttr(desc)}">
<link rel="canonical" href="${base}/m/${m.bioguide}.html">
<meta property="og:title" content="${escAttr(`${m.name}: ${grade}`)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:image" content="${base}/og/${m.bioguide}.png">
<meta property="og:url" content="${base}/m/${m.bioguide}.html">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="Congressional Injury Report">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=Libre+Franklin:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/styles.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏛️</text></svg>">
<script type="application/ld+json">${ldJson}</script>
<script src="/assets/analytics.js"></script>
</head>
<body>
<header class="masthead">
  <div class="masthead-inner">
    <p class="kicker">United States Congress · Member Report Card</p>
    <div class="rule-ornament" aria-hidden="true">★ ★ ★</div>
    <h1>${escHtml(first)} <em>${escHtml(last)}</em></h1>
    <p class="sub">${escHtml([m.title, `${seat} · ${chamberName} · ${sessionYear} Session`].filter(Boolean).join(" · "))}</p>
    <nav>
      <a href="/">Injury Report</a>
      <a href="/today.html">Today in Congress</a>
    </nav>
  </div>
</header>

<main>
  <div class="search">
    <input id="member-search" type="text" autocomplete="off" spellcheck="false"
      placeholder="Search another member — name, state, seat, or ZIP" aria-label="Search members of Congress by name, state, seat, or ZIP code">
    <div class="search-results" id="search-results"></div>
  </div>
  <div id="card">
    <div class="report-card">
      <p class="rc-label">Official Attendance Record</p>
      <div class="grade-seal ${poor ? "poor" : ""}">${escHtml(grade)}</div>
      <div class="rc-pct">${pctText}</div>
      <div class="rc-stats">
        <div><div class="label">Votes attended</div><div class="value">${s.attended}</div></div>
        <div><div class="label">Votes eligible</div><div class="value">${s.eligible}</div></div>
        <div><div class="label">Votes missed</div><div class="value">${s.missed}</div></div>
        <div><div class="label">Chamber rank</div><div class="value">${rank}</div></div>
      </div>
      ${statusHtml}
      ${speakerHtml}
      <a class="rc-back" href="/">← Back to the Injury Report</a>
    </div>
  </div>
</main>

<footer>
  <p><strong>Grading:</strong> attendance across every roll-call vote of the current session. 99%+ earns an A+,
  below 65% is an F; members with fewer than ten eligible votes receive an incomplete. Data from official
  <a href="https://clerk.house.gov">House Clerk</a> and
  <a href="https://www.senate.gov/legislative/votes_new.htm">Senate</a> roll-call records, updated daily.</p>
</footer>
<script src="/assets/search.js"></script>
</body>
</html>
`;
}

// XML sitemap of every indexable URL, so crawlers discover all member pages.
function sitemapXml(memberStats, base) {
  const lastmod = (memberStats.generatedAt || new Date().toISOString()).slice(0, 10);
  const urls = [
    `${base}/`,
    `${base}/today.html`,
    ...memberStats.members.map((m) => `${base}/m/${m.bioguide}.html`),
  ];
  const body = urls
    .map((loc) => `  <url><loc>${escAttr(loc)}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

const robotsTxt = (base) => `User-agent: *
Allow: /

Sitemap: ${base}/sitemap.xml
`;

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

  let cards = 0;
  let pages = 0;
  for (const m of memberStats.members) {
    if (await writeIfChanged(path.join(OG_DIR, `${m.bioguide}.png`), memberCard(m))) cards++;
    if (await writeIfChanged(path.join(M_DIR, `${m.bioguide}.html`),
        Buffer.from(memberPage(m, base, memberStats.sessionYear)))) pages++;
  }
  await writeIfChanged(path.join(OG_DIR, "site.png"), siteCard());

  // Sitemap + robots need absolute URLs; only emit when a domain is configured.
  if (base) {
    await writeIfChanged(path.join(SITE_DIR, "sitemap.xml"), Buffer.from(sitemapXml(memberStats, base)));
    await writeIfChanged(path.join(SITE_DIR, "robots.txt"), Buffer.from(robotsTxt(base)));
  }
  log("og", `${memberStats.members.length} members: ${cards} cards, ${pages} pages changed` +
    (base ? "; sitemap + robots updated" : "; no CNAME — skipped sitemap"));
}
