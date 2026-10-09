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

// Palette mirrors the site's light "Archives" theme (site/assets/styles.css).
const PAGE = "#ffffff";
const INK = "#1b1b1b";
const INK_2 = "#3b3a36";
const MUTED = "#5c5a55";
const RULE = "#dedad0";
const OXBLOOD = "#7b1e1e";
const OXBLOOD_TINT = "#f0dede";
const UTILITY = "#141414";
const LINK = "#1d4f91";
const STATUS_COLORS = { OUT: "#a01b1b", IR: "#8a4300", QUESTIONABLE: "#6a5600", PROBABLE: "#2d6338" };
const STATUS_LABELS = { OUT: "Out", IR: "Injured Reserve", QUESTIONABLE: "Questionable", PROBABLE: "Probable" };
const statusLabel = (s) => STATUS_LABELS[s] ?? s;

GlobalFonts.registerFromPath(path.join(ROOT, "scripts/og-assets/LibreCaslonText-Regular.ttf"), "Caslon");
GlobalFonts.registerFromPath(path.join(ROOT, "scripts/og-assets/PublicSans-SemiBold.ttf"), "PublicSansSemi");
GlobalFonts.registerFromPath(path.join(ROOT, "scripts/og-assets/PublicSans-Bold.ttf"), "PublicSansBold");

async function siteBase() {
  try {
    const domain = (await readFile(path.join(ROOT, "site", "CNAME"), "utf8")).trim();
    return `https://${domain}`;
  } catch {
    return "";
  }
}

const W = 1200;
const H = 630;
const X0 = 80;          // left margin
const X1 = W - 80;      // right margin

// Uppercase label with letter-spacing, drawn glyph by glyph so the result
// doesn't depend on canvas letterSpacing support. Returns the drawn width.
function tracked(ctx, text, x, y, { font, color, spacing, align = "left" }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  const chars = [...text.toUpperCase()];
  const width = chars.reduce((w, c) => w + ctx.measureText(c).width + spacing, 0) - spacing;
  let cx = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
  for (const c of chars) {
    ctx.fillText(c, cx, y);
    cx += ctx.measureText(c).width + spacing;
  }
  return width;
}

function rule(ctx, x0, y, x1, color, width = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x0, y, x1 - x0, width);
}

// The capitol seal from the site masthead, scaled to radius r around (cx, cy).
function seal(ctx, cx, cy, r, color) {
  const k = r / 27; // the masthead SVG is drawn on a 54px box
  ctx.save();
  ctx.translate(cx - 27 * k, cy - 27 * k);
  ctx.scale(k, k);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(27, 27, 25.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(27, 27, 21, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of [[14, 36, 40, 36], [16, 33, 38, 33], [15, 24, 39, 24],
    [18, 33, 18, 24], [22.5, 33, 22.5, 24], [27, 33, 27, 24], [31.5, 33, 31.5, 24], [36, 33, 36, 24]]) {
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  }
  ctx.moveTo(17, 24); ctx.lineTo(27, 17); ctx.lineTo(37, 24);
  ctx.stroke();
  ctx.restore();
}

// Shared chrome: utility strip, oxblood masthead band, and footer rule.
function drawChrome(ctx) {
  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = UTILITY;
  ctx.fillRect(0, 0, W, 12);
  ctx.fillStyle = OXBLOOD;
  ctx.fillRect(0, 12, W, 120);
  seal(ctx, X0 + 34, 72, 34, "#ffffff");
  ctx.font = "40px Caslon";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText("Congressional Injury Report", X0 + 90, 72);
  tracked(ctx, "Daily Attendance Register · House & Senate", X0 + 92, 104,
    { font: "16px PublicSansSemi", color: OXBLOOD_TINT, spacing: 3 });

  rule(ctx, X0, 548, X1, RULE);
  ctx.font = "22px PublicSansSemi";
  ctx.fillStyle = LINK;
  ctx.textAlign = "left";
  ctx.fillText("congressinjuryreport.com", X0, 590);
  ctx.font = "18px PublicSansSemi";
  ctx.fillStyle = MUTED;
  ctx.textAlign = "right";
  ctx.fillText("House Clerk · Senate roll calls · Congressional Record", X1, 589);
  ctx.textAlign = "left";
}

function fitText(ctx, text, maxWidth, px, font) {
  let size = px;
  do {
    ctx.font = `${size}px ${font}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  } while (size > 30);
  return size;
}

function memberCard(m) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawChrome(ctx);

  const colRight = 790; // left column ends here; grade block starts after the rule
  tracked(ctx, "Member record", X0, 206, { font: "18px PublicSansSemi", color: MUTED, spacing: 2.5 });

  // Name (shrink to fit the left column), with typographic quotes on nicknames
  const name = m.name.replace(/"([^"]*)"/g, "\u201c$1\u201d");
  const size = fitText(ctx, name, colRight - X0 - 40, 74, "Caslon");
  ctx.font = `${size}px Caslon`;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.fillText(name, X0, 206 + 22 + size * 0.95);

  // Seat line
  const seat = m.chamber === "senate"
    ? `${m.party}-${m.state} · United States Senate`
    : `${m.party}-${m.state}${m.district ? "-" + m.district : ""} · House of Representatives`;
  const seatText = [m.title, seat].filter(Boolean).join(" · ");
  ctx.font = "24px PublicSansSemi";
  ctx.fillStyle = INK_2;
  let seatSize = 24;
  while (ctx.measureText(seatText).width > colRight - X0 - 20 && seatSize > 16) {
    seatSize -= 2;
    ctx.font = `${seatSize}px PublicSansSemi`;
  }
  ctx.fillText(seatText, X0, 206 + 22 + size * 0.95 + 50);

  // Status line (only when listed), set off by a rule like the site's notice
  if (m.status) {
    rule(ctx, X0, 410, colRight - 20, INK, 2);
    tracked(ctx, statusLabel(m.status.status), X0, 456, {
      font: "26px PublicSansBold", color: STATUS_COLORS[m.status.status] ?? INK, spacing: 2,
    });
    if (m.status.reason) {
      // Reasons sit on their own line; they're short ("medical procedure") but
      // can run to ~10 words, so shrink rather than spill past the column.
      const reason = m.status.reason.charAt(0).toUpperCase() + m.status.reason.slice(1);
      let px = 24;
      ctx.font = `${px}px PublicSansSemi`;
      while (ctx.measureText(reason).width > colRight - 20 - X0 && px > 16) {
        px -= 2;
        ctx.font = `${px}px PublicSansSemi`;
      }
      ctx.fillStyle = INK_2;
      ctx.textAlign = "left";
      ctx.fillText(reason, X0, 496);
    }
  }

  // Grade block (right): ruled top, label, large Caslon letter
  const gx = colRight + 40;
  ctx.fillStyle = RULE;
  ctx.fillRect(colRight, 180, 1, 330); // vertical divider
  rule(ctx, gx, 180, X1, INK, 2);
  tracked(ctx, "Session grade", gx, 222, { font: "18px PublicSansSemi", color: MUTED, spacing: 2.5 });
  const poor = m.session.grade === "F" || m.session.grade === "D";
  ctx.font = "200px Caslon";
  ctx.fillStyle = poor ? STATUS_COLORS.OUT : INK;
  ctx.textAlign = "left";
  ctx.fillText(m.session.grade, gx - 6, 440);
  rule(ctx, gx, 508, X1, RULE);

  return canvas.toBuffer("image/png");
}

function siteCard() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawChrome(ctx);

  tracked(ctx, "Updated daily from official roll calls", X0, 214,
    { font: "18px PublicSansSemi", color: MUTED, spacing: 2.5 });
  ctx.font = "84px Caslon";
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.fillText("Who’s out in Congress,", X0, 316);
  ctx.fillText("and why.", X0, 412);

  rule(ctx, X0, 452, X1, INK, 2);
  let x = X0;
  for (const s of ["OUT", "IR", "QUESTIONABLE", "PROBABLE"]) {
    x += tracked(ctx, statusLabel(s), x, 500, { font: "22px PublicSansBold", color: STATUS_COLORS[s], spacing: 2 }) + 44;
  }
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
  const jobTitle = m.title || (m.chamber === "senate" ? "United States Senator" : "United States Representative");

  const title = `${m.name} — ${grade} | Congressional Injury Report`;
  const desc = m.status
    ? `${statusLabel(m.status.status)}${m.status.reason ? " — " + m.status.reason : ""}. ${s.pct}% attendance this session (${s.missed} votes missed).`
    : `${s.pct === null ? "New this session" : s.pct + "% attendance this session"} — ranked ${s.rank ?? "—"} of ${s.of ?? "—"} in the ${m.chamber === "senate" ? "Senate" : "House"}.`;

  const poor = grade === "F" || grade === "D";
  const rank = s.rank ? `${ordinal(s.rank)}<small> of ${s.of}</small>` : "—";
  const pctText = s.pct === null ? "Insufficient record" : `${s.pct}% attendance this session`;

  let statusHtml = "";
  if (m.status) {
    let note = escHtml(m.status.note).replace(/\d{4}-\d{2}-\d{2}/g, (d) => fmtDate(d));
    note = note.charAt(0).toUpperCase() + note.slice(1);
    const why = m.status.reason
      ? `<span class="reason">${escHtml(m.status.reason)}</span>${m.status.detail ? " — " + escHtml(m.status.detail) : ""}. `
      : "";
    statusHtml = `<p class="rc-status">
      <span class="status-label ${escAttr(m.status.status)}">${escHtml(statusLabel(m.status.status))}</span>
      ${why}${note}${m.status.since ? ` (since ${fmtDate(m.status.since)})` : ""}.
    </p>`;
  } else if (s.pct !== null) {
    statusHtml = `<p class="rc-status">Active — no absence flags on the current report.</p>`;
  }
  const speakerHtml = /Speaker/i.test(m.title ?? "")
    ? `<p class="rc-note">By tradition, the Speaker of the House votes at the chair's discretion; presiding days without a recorded position do not count against attendance.</p>`
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
<link href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/styles.css">
<script src="/assets/theme.js"></script>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">${ldJson}</script>
<script src="/assets/analytics.js"></script>
</head>
<body>
<!-- site-header:start -->
<div class="utility"><div class="wrap">
  <span>An independent register of attendance in the United States Congress</span>
  <span>Sources: House Clerk · Senate roll calls · Congressional Record</span>
</div></div>
<header class="masthead"><div class="wrap masthead-row">
  <a class="brand" href="/">
    <svg width="54" height="54" viewBox="0 0 54 54" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="27" cy="27" r="25.5"/><circle cx="27" cy="27" r="21"/><path d="M14 36h26M16 33h22M18 33V24M22.5 33V24M27 33V24M31.5 33V24M36 33V24M15 24h24M17 24l10-7 10 7"/></svg>
    <span><span class="brand-name">Congressional Injury Report</span><span class="brand-sub">Daily Attendance Register · House &amp; Senate</span></span>
  </a>
  <div class="search" role="search">
    <label class="sr-only" for="member-search">Find a member of Congress by name, state, seat, or ZIP code</label>
    <input id="member-search" type="search" autocomplete="off" spellcheck="false" placeholder="Find your rep — name, state, or ZIP" />
    <div class="search-results" id="search-results"></div>
  </div>
</div></header>
<nav class="primary-nav" aria-label="Site"><div class="wrap">
  <a href="/" data-nav="report">Injury Report</a>
  <a href="/today.html" data-nav="today">Today in Congress</a>
  <a href="/#how" data-nav="how">How It Works</a>
  <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode"></button>
</div></nav>
<!-- site-header:end -->

<main class="wrap">
  <div class="crumbs"><a href="/">Injury Report</a> <span aria-hidden="true">›</span> Member record</div>
  <h1 class="page-title">${escHtml(m.name)}</h1>
  <p class="dateline">${escHtml([m.title, `${seat} · ${chamberName} · ${sessionYear} Session`].filter(Boolean).join(" · "))}</p>
  <div id="card">
    <section class="record" aria-label="Session attendance">
      <div class="grade-block">
        <span class="ledger-label">Session grade</span>
        <div class="grade-letter ${poor ? "poor" : ""}">${escHtml(grade)}</div>
        <div class="grade-pct">${pctText}</div>
      </div>
      <div class="ledger">
        <div><span class="ledger-label">Votes attended</span><span class="ledger-value">${s.attended}</span></div>
        <div><span class="ledger-label">Votes eligible</span><span class="ledger-value">${s.eligible}</span></div>
        <div><span class="ledger-label">Votes missed</span><span class="ledger-value">${s.missed}</span></div>
        <div><span class="ledger-label">Chamber rank</span><span class="ledger-value">${rank}</span></div>
      </div>
    </section>
    ${statusHtml}
    ${speakerHtml}
    <a class="rc-back" href="/">← Back to the Injury Report</a>
  </div>
</main>

<footer class="site-footer"><div class="wrap">
  <p><strong>Grading:</strong> attendance across every roll-call vote of the current session. 99%+ earns an A+,
  below 65% is an F; members with fewer than ten eligible votes receive an incomplete. Data from official
  <a href="https://clerk.house.gov">House Clerk</a> and
  <a href="https://www.senate.gov/legislative/votes_new.htm">Senate</a> roll-call records, updated daily.</p>
  <p>Not affiliated with the U.S. Congress.</p>
</div></footer>
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
