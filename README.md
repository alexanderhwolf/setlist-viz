# How many times has Rush played it?

A single-page web app visualizing Rush's live performance history — career play
counts per song, an album-level leaderboard, studio tracks never played live, and
setlists from the 2026 Fifty Something tour. Mobile-first, installable as a PWA,
works offline.

Data comes from the [setlist.fm](https://www.setlist.fm) API, used with permission,
refreshed daily by CI. setlist.fm is credited and linked on every view.

---

## Stack

- **Vite + React** — static build, no server.
- **Tailwind CSS v4** — via the official Vite plugin.
- **vite-plugin-pwa** — service worker + manifest, installable to a phone home screen.
- **Python build step** — `fetch_setlistfm.py` pulls fresh data from the API into
  `src/rush-data.json` before each build.

---

## One-time local setup

You need Node 20+ and Python 3.10+.

```bash
npm install
```

Set your setlist.fm API key as an environment variable (never commit it):

```bash
export SETLISTFM_API_KEY="your-key-here"      # macOS / Linux
set SETLISTFM_API_KEY=your-key-here           # Windows cmd
$env:SETLISTFM_API_KEY="your-key-here"        # Windows PowerShell
```

## Refresh the data

```bash
npm run data            # incremental: fetch only what's new, rebuild src/rush-data.json
python fetch_setlistfm.py --full   # full crawl: re-fetch every setlist from scratch
```

**How it stays cheap.** All raw setlists are stored in `data/setlists.json` (committed
to the repo). setlist.fm returns shows newest-first, so the default **incremental**
run fetches only page 1, merges anything new or edited (detected via each setlist's
`versionId`), and stops as soon as it hits shows it already has — usually **one API
call**. It then rebuilds all six datasets (songs, albums, never-played, leaderboard,
tour shows, tour frequency) from the store and writes `src/rush-data.json`.

Run `--full` occasionally (say monthly) to pick up retroactive edits to *old* shows,
which an incremental run won't see. The first run on a machine with no store also does
a full crawl automatically. Requests are throttled ~1/sec to be polite; pages are also
cached to `.cache/` (gitignored) within a run.

## Run locally

```bash
npm run dev       # dev server at http://localhost:5173
npm run build     # production build into dist/
npm run preview   # preview the production build
```

---

## Deploy to Cloudflare Pages

Cloudflare builds and hosts the site directly from the GitHub repo, and a daily
GitHub Action refreshes the data. Only **one secret** is required.

### 1. Push to GitHub

Create a repo and push this project. `node_modules/`, `dist/`, and `.cache/` are
gitignored; `data/setlists.json` and `src/rush-data.json` ARE committed (they're the
data the site builds from).

### 2. Connect the repo to Cloudflare Pages

- Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
- Pick the repo. Framework preset: **Vite**. Build command: `npm run build`.
  Build output directory: `dist`. Save & deploy.
- Cloudflare rebuilds on every push to `main`, so the daily data commit (below) makes
  it redeploy automatically. A `.node-version` file pins Node 20 for the build.

### 3. Add one secret to GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Where to get it |
| --- | --- |
| `SETLISTFM_API_KEY` | Your setlist.fm API key. |

No Cloudflare token is needed — Cloudflare's Git integration handles deploys.

### 4. That's it

`.github/workflows/deploy.yml` runs **daily at 11:00 UTC** (~6–7am US) and on manual
trigger from the Actions tab. Each run fetches new setlists (incremental — usually one
API call), and if anything changed, commits `src/rush-data.json` + `data/setlists.json`.
That commit triggers Cloudflare to rebuild and redeploy.

To change the refresh time, edit the `cron:` line (UTC). Run `--full` locally and push
occasionally to catch retroactive edits to old shows.

---

## Before you go public — checklist

- [ ] Replace the portfolio URL in `src/App.jsx` (search for `your-portfolio-url.example`).
- [ ] Confirm the footer attribution reads correctly for you.
- [ ] Keep it non-commercial. setlist.fm's free API tier is non-commercial; the
      approved use here is a free, ad-free app that links to your portfolio. **Adding
      ads, tips, affiliate links, or a paid tier is a separate conversation with
      setlist.fm** — email them first.
- [ ] Don't scrape or store setlist.fm *user* data (contributor names, etc.). This app
      only stores song/setlist data, which is fine.

---

## Data notes / caveats

- Counts are the number of documented concerts including a song; fan-submitted, so
  1970s shows are undercounted relative to later tours.
- "Never played" = no documented performance, not proof it never happened.
- Multi-part suites (2112, Hemispheres, etc.) are logged section-by-section; album
  counts show the most-played section.
- Taped intros/interludes are excluded (setlist.fm flags them as "played from tape").

If the **2026 tour tab comes up empty** after an API refresh, setlist.fm may have
changed the tour's name string. Check `CURRENT_TOUR` near the top of
`fetch_setlistfm.py` and match it to the exact `tour.name` the API returns.
