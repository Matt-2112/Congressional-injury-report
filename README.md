# 🏛️ Congressional Injury Report

An NFL-style injury report for the United States Congress: who's OUT, DOUBTFUL,
QUESTIONABLE, or PROBABLE — and why — plus a "Today in Congress" page covering
what's on the floor. Updated daily from official sources.

## How it works

```
GitHub Actions (daily, 6 AM ET)
  └─ node scripts/run.js
       1. roster        ← unitedstates/congress-legislators (no key)
       2. votes         ← Senate LIS XML + House Clerk EVS XML (no key)
       3. record text   ← govinfo Congressional Record bulk data (no key)
       4. reasons       ← Claude API extracts leave-of-absence grants and
                          personal explanations (needs ANTHROPIC_API_KEY)
       5. agenda        ← Claude API summarizes the Daily Digest
       6. report        ← status tiers → site/data/*.json
  └─ commits fresh JSON and deploys site/ to GitHub Pages
```

Beyond the daily report, the site includes: member search; per-member
**report cards** (`/m/<bioguide>.html`) grading full-session attendance
A+ through F with chamber rank and social share cards; and **Absences That
Mattered** — votes where the absent members outnumbered the margin.

### Status tiers

| Status | Rule |
|---|---|
| **OUT** | Granted a leave of absence, or missed every vote on the most recent vote day |
| **DOUBTFUL** | Missed every vote on 3+ consecutive vote days, no announced return |
| **QUESTIONABLE** | Missed at least half (but not all) of the latest day's votes |
| **PROBABLE** | Voted most recently, but sat out a full vote day within the past week |

## Local usage

```sh
npm install
cp .env.example .env       # add ANTHROPIC_API_KEY for reasons + agenda (optional)
node scripts/run.js        # fetch data, build site/data/*.json
npm run serve              # http://localhost:8080
```

The pipeline degrades gracefully: without an `ANTHROPIC_API_KEY`, absences are
still detected from roll-call data but reasons show as "Undisclosed" and the
agenda page falls back to links to official sources.

## Workflows

- **Daily injury report** (cron 6 AM ET + manual): runs the pipeline, commits
  fresh data, then deploys. Vote XML is cached between runs.
- **Deploy site** (any push touching `site/**` + manual): deploys Pages
  without a pipeline run — frontend changes ship on push.

## Deploying

1. Push to GitHub and enable **Settings → Pages → Source: GitHub Actions**.
2. Add repository secret `ANTHROPIC_API_KEY` (Settings → Secrets → Actions).
3. Run the **Daily injury report** workflow manually once (Actions tab →
   workflow_dispatch), then it runs itself every morning.

## Data sources

- [House Clerk roll-call XML](https://clerk.house.gov) (`/evs/{year}/rollNNN.xml`)
- [Senate LIS roll-call XML](https://www.senate.gov/legislative/votes_new.htm)
- [Congressional Record via govinfo bulk data](https://www.govinfo.gov/app/collection/CREC)
- [House Republican Cloakroom leave-of-absence page](https://repcloakroom.house.gov/leave-of-absence/)
- [congress-legislators](https://github.com/unitedstates/congress-legislators) member roster

Not affiliated with the United States Congress or the National Football League.
