#!/usr/bin/env python3
"""
Build the data file for the Rush setlist app from the official setlist.fm API.

Usage:
    export SETLISTFM_API_KEY=your-key-here     # Windows: set SETLISTFM_API_KEY=...
    python3 fetch_setlistfm.py                 # writes rush-data.json
    python3 fetch_setlistfm.py --inject RushSetlistCounter.jsx   # also updates the app

Notes:
  - The key is read from the environment. Never hardcode it, never commit it,
    and never ship it to the browser. This script runs at build time; the app
    only ever sees the generated rush-data.json.
  - setlist.fm asks for ~1 request/second. We sleep between calls and cache
    every page to ./.cache so re-runs are cheap and don't hammer them.
  - Non-commercial use only, and credit setlist.fm visibly in the UI.
"""

import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.error
from collections import Counter, defaultdict
from pathlib import Path

API = "https://api.setlist.fm/rest/1.0"
RUSH_MBID = "0d9d4f1a-1a5a-4f0a-9a1e-0000000000"  # replaced below via lookup
RUSH_MBID = "1b1fc4b6-a10c-4d2e-a4d0-c9a2b0c8b3e5"  # placeholder; resolved at runtime
ARTIST_NAME = "Rush"
CACHE = Path(".cache")
STORE = Path(os.environ.get("SETLIST_STORE", "data/setlists.json"))  # persistent raw setlist store
SLEEP = 1.1  # seconds between requests — be polite

KEY = os.environ.get("SETLISTFM_API_KEY")
if not KEY:
    sys.exit("Set SETLISTFM_API_KEY in your environment first (see docstring).")


def get(path, params=None, ttl_hours=24):
    """GET a JSON endpoint, with on-disk caching and basic retry."""
    qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in (params or {}).items())
    url = f"{API}{path}" + (f"?{qs}" if qs else "")

    CACHE.mkdir(exist_ok=True)
    cf = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if cf.exists() and (time.time() - cf.stat().st_mtime) < ttl_hours * 3600:
        return json.loads(cf.read_text())

    req = urllib.request.Request(url, headers={
        "x-api-key": KEY,
        "Accept": "application/json",
        "User-Agent": "rush-setlist-viz/1.0 (personal project)",
    })

    attempts = 6
    last_err = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode())
            cf.write_text(json.dumps(data))
            time.sleep(SLEEP)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last_err = e
            if e.code in (429, 500, 502, 503):
                # honor Retry-After if present, else exponential backoff capped at 60s
                ra = e.headers.get("Retry-After") if e.headers else None
                wait = int(ra) if (ra and str(ra).isdigit()) else min(60, 4 * (2 ** attempt))
                p = (params or {}).get("p", "")
                print(f"  HTTP {e.code} on {path} p{p} — waiting {wait}s (attempt {attempt+1}/{attempts})", file=sys.stderr)
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, OSError) as e:
            last_err = e
            wait = min(60, 4 * (2 ** attempt))
            print(f"  network error on {path} — waiting {wait}s (attempt {attempt+1}/{attempts})", file=sys.stderr)
            time.sleep(wait)
            continue
    # all attempts exhausted — signal failure to the caller
    raise last_err if last_err else RuntimeError(f"request failed: {url}")


def resolve_mbid():
    r = get("/search/artists", {"artistName": ARTIST_NAME, "sort": "relevance"})
    for a in r.get("artist", []):
        if a["name"].lower() == ARTIST_NAME.lower():
            print(f"Resolved {ARTIST_NAME} -> {a['mbid']}")
            return a["mbid"]
    sys.exit(f"Could not resolve MBID for {ARTIST_NAME}")


def all_setlists(mbid):
    """Page through every setlist for the artist.

    Resilient by design: cached pages (from a prior run) load instantly, so
    re-running resumes where it left off. If a page still fails after all retries,
    we stop and return what we have rather than crashing — the newest shows are on
    the first pages, so a partial pull is still useful. Returns (setlists, complete, total).
    """
    out, page, complete, total = [], 1, True, 0
    while True:
        try:
            r = get(f"/artist/{mbid}/setlists", {"p": page})
        except Exception as e:
            print(f"  page {page} failed after retries ({e})", file=sys.stderr)
            print(f"  continuing with the {len(out)} setlists gathered so far — "
                  f"re-run to resume from the cache.", file=sys.stderr)
            complete = False
            break
        if not r or "setlist" not in r:
            break
        out.extend(r["setlist"])
        total, per = r.get("total", 0), r.get("itemsPerPage", 20)
        print(f"  page {page} — {len(out)}/{total} setlists")
        if page * per >= total:
            break
        page += 1
    return out, complete, total


# ---------------------------------------------------------------- persistent store
# We keep every raw setlist on disk (data/setlists.json), keyed by id. That lets the
# daily refresh fetch only the newest page(s) instead of re-crawling all 122 pages.
def load_store():
    if STORE.exists():
        return {s["id"]: s for s in json.loads(STORE.read_text()) if s.get("id")}
    return {}


def _date_key(sl):
    # eventDate is dd-MM-yyyy; reorder to yyyy-MM-dd so it sorts chronologically
    d, m, y = (sl.get("eventDate", "01-01-1900").split("-") + ["", "", ""])[:3]
    return (y, m, d)


def save_store(store):
    STORE.parent.mkdir(parents=True, exist_ok=True)
    items = sorted(store.values(), key=_date_key, reverse=True)  # newest first, stable diffs
    STORE.write_text(json.dumps(items, separators=(",", ":")))


def merge_page(page_setlists, store):
    """Merge a page into the store. Returns how many were new or changed.
    setlist.fm bumps versionId on every edit, so that's our change signal."""
    changed = 0
    for sl in page_setlists:
        sid = sl.get("id")
        if not sid:
            continue
        old = store.get(sid)
        if old is None or old.get("versionId") != sl.get("versionId"):
            store[sid] = sl
            changed += 1
    return changed


def sync_incremental(mbid, store):
    """Fetch newest pages only, stopping once a page holds nothing new.
    A normal daily run touches just page 1 → one API call."""
    page, total, touched = 1, 0, 0
    while True:
        r = get(f"/artist/{mbid}/setlists", {"p": page}, ttl_hours=0)  # always check page 1 fresh
        if not r or "setlist" not in r:
            break
        pg = r["setlist"]
        total = r.get("total", total)
        changed = merge_page(pg, store)
        touched += changed
        print(f"  page {page}: {changed}/{len(pg)} new or changed")
        if changed < len(pg):   # reached overlap with what we already have
            break
        page += 1
    return total, touched


def songs_of(sl):
    """Flatten a setlist's sets into (name, is_encore) pairs, skipping tape tracks."""
    for s in sl.get("sets", {}).get("set", []):
        encore = 1 if s.get("encore") else 0
        for song in s.get("song", []):
            if song.get("tape"):
                continue  # played from tape, not performed
            name = (song.get("name") or "").strip()
            if name:
                yield name, encore


# ---------------------------------------------------------------- discography
# Studio albums only. Suites are logged part-by-part on setlist.fm, so the
# album-level count uses the most-played section (see SUITES).
ALBUMS = [
    ("Rush", 1974, ["Finding My Way", "Need Some Love", "Take a Friend", "Here Again", "What You're Doing", "In the Mood", "Before and After", "Working Man"]),
    ("Fly by Night", 1975, ["Anthem", "Best I Can", "Beneath, Between & Behind", "By-Tor & the Snow Dog", "Fly by Night", "Making Memories", "Rivendell", "In the End"]),
    ("Caress of Steel", 1975, ["Bastille Day", "I Think I'm Going Bald", "Lakeside Park", "The Necromancer", "The Fountain of Lamneth"]),
    ("2112", 1976, ["2112", "A Passage to Bangkok", "The Twilight Zone", "Lessons", "Tears", "Something for Nothing"]),
    ("A Farewell to Kings", 1977, ["A Farewell to Kings", "Xanadu", "Closer to the Heart", "Cinderella Man", "Madrigal", "Cygnus X-1"]),
    ("Hemispheres", 1978, ["Cygnus X-1 Book II: Hemispheres", "Circumstances", "The Trees", "La Villa Strangiato"]),
    ("Permanent Waves", 1980, ["The Spirit of Radio", "Freewill", "Jacob's Ladder", "Entre Nous", "Different Strings", "Natural Science"]),
    ("Moving Pictures", 1981, ["Tom Sawyer", "Red Barchetta", "YYZ", "Limelight", "The Camera Eye", "Witch Hunt", "Vital Signs"]),
    ("Signals", 1982, ["Subdivisions", "The Analog Kid", "Chemistry", "Digital Man", "The Weapon", "New World Man", "Losing It", "Countdown"]),
    ("Grace Under Pressure", 1984, ["Distant Early Warning", "Afterimage", "Red Sector A", "The Enemy Within", "The Body Electric", "Kid Gloves", "Red Lenses", "Between the Wheels"]),
    ("Power Windows", 1985, ["The Big Money", "Grand Designs", "Manhattan Project", "Marathon", "Territories", "Middletown Dreams", "Emotion Detector", "Mystic Rhythms"]),
    ("Hold Your Fire", 1987, ["Force Ten", "Time Stand Still", "Open Secrets", "Second Nature", "Prime Mover", "Lock and Key", "Mission", "Turn the Page", "Tai Shan", "High Water"]),
    ("Presto", 1989, ["Show Don't Tell", "Chain Lightning", "The Pass", "War Paint", "Scars", "Presto", "Superconductor", "Anagram (for Mongo)", "Red Tide", "Hand Over Fist", "Available Light"]),
    ("Roll the Bones", 1991, ["Dreamline", "Bravado", "Roll the Bones", "Face Up", "Where's My Thing?", "The Big Wheel", "Heresy", "Ghost of a Chance", "Neurotica", "You Bet Your Life"]),
    ("Counterparts", 1993, ["Animate", "Stick It Out", "Cut to the Chase", "Nobody's Hero", "Between Sun and Moon", "Alien Shore", "The Speed of Love", "Double Agent", "Leave That Thing Alone", "Cold Fire", "Everyday Glory"]),
    ("Test for Echo", 1996, ["Test for Echo", "Driven", "Half the World", "The Color of Right", "Time and Motion", "Totem", "Dog Years", "Virtuality", "Resist", "Limbo", "Carve Away the Stone"]),
    ("Vapor Trails", 2002, ["One Little Victory", "Ceiling Unlimited", "Ghost Rider", "Peaceable Kingdom", "The Stars Look Down", "How It Is", "Vapor Trail", "Secret Touch", "Earthshine", "Sweet Miracle", "Nocturne", "Freeze (Part IV of Fear)", "Out of the Cradle"]),
    ("Snakes & Arrows", 2007, ["Far Cry", "Armor and Sword", "Workin' Them Angels", "The Larger Bowl (A Pantoum)", "Spindrift", "The Main Monkey Business", "The Way the Wind Blows", "Hope", "Faithless", "Bravest Face", "Good News First", "Malignant Narcissism", "We Hold On"]),
    ("Clockwork Angels", 2012, ["Caravan", "BU2B", "Clockwork Angels", "The Anarchist", "Carnies", "Halo Effect", "Seven Cities of Gold", "The Wreckers", "Headlong Flight", "BU2B2", "Wish Them Well", "The Garden"]),
]

SUITES = {"2112", "The Fountain of Lamneth", "The Necromancer", "Cygnus X-1 Book II: Hemispheres"}
ALIAS = {"By-Tor & the Snow Dog": "By-Tor & The Snow Dog", "The Larger Bowl (A Pantoum)": "The Larger Bowl"}

CURRENT_TOUR = "Fifty Something Tour"  # tour name as it appears in setlist.fm's tour field


def main():
    mbid = resolve_mbid()
    store = load_store()
    full = ("--full" in sys.argv) or not store

    if full:
        why = "requested" if "--full" in sys.argv else "no store yet"
        print(f"Full crawl of all setlists ({why})…")
        crawled, complete, total = all_setlists(mbid)
        for sl in crawled:
            if sl.get("id"):
                store[sl["id"]] = sl
        changed = len(crawled)
    else:
        print("Incremental refresh — newest pages only…")
        total, changed = sync_incremental(mbid, store)
        complete = True

    save_store(store)
    sls = list(store.values())
    print(f"{len(sls)} setlists in store — {changed} new/updated this run"
          + (f", {total} on setlist.fm" if total else ""))
    if full and not complete:
        print(f"  NOTE: crawl was incomplete ({len(sls)}/{total}); re-run to finish "
              f"(cached pages load instantly).", file=sys.stderr)

    # ---- career counts: one increment per show that contained the song
    counts = Counter()
    for sl in sls:
        for name in {n for n, _ in songs_of(sl)}:
            counts[name] += 1

    songs = sorted(
        [{"n": n, "c": c} for n, c in counts.items()],
        key=lambda s: -s["c"],
    )
    for i, s in enumerate(songs):
        s["r"] = i + 1

    # ---- albums
    def count_for(track):
        if track in SUITES:
            parts = [c for n, c in counts.items() if n.startswith(track + " Part")]
            return max(parts) if parts else 0
        return counts.get(ALIAS.get(track, track), 0)

    albums, never = [], []
    for title, year, tracks in ALBUMS:
        ts = []
        for i, t in enumerate(tracks):
            c = count_for(t)
            d = {"n": t, "c": c, "t": i + 1}
            if t in SUITES:
                d["s"] = 1
            ts.append(d)
            if c == 0:
                never.append({"n": t, "a": title, "y": year})
        albums.append({"a": title, "y": year, "tracks": ts})

    leader = sorted(
        [{"a": a["a"], "y": a["y"], "t": sum(x["c"] for x in a["tracks"]), "i": i} for i, a in enumerate(albums)],
        key=lambda x: -x["t"],
    )

    # ---- current tour
    tour_shows = []
    for sl in sls:
        if (sl.get("tour") or {}).get("name") != CURRENT_TOUR:
            continue
        songs_list = [{"n": n, "e": e} for n, e in songs_of(sl)]
        if not songs_list:
            continue  # scheduled but no setlist logged yet
        v = sl.get("venue", {})
        city = v.get("city", {})
        loc = ", ".join(filter(None, [city.get("name"), (city.get("stateCode") or ""), (city.get("country") or {}).get("name")]))
        d, m, y = sl["eventDate"].split("-")  # dd-MM-yyyy
        tour_shows.append({
            "date": f"{y}-{m}-{d}",
            "venue": v.get("name", ""),
            "city": loc,
            "url": sl.get("url", ""),
            "songs": songs_list,
        })
    tour_shows.sort(key=lambda s: s["date"])

    freq = Counter(x["n"] for s in tour_shows for x in s["songs"])
    freq_list = [{"n": n, "k": k} for n, k in freq.most_common()]

    # ---- per-show setlists for EVERY named tour (lazy-loaded by the app)
    shows_by_tour = defaultdict(list)
    for sl in sls:
        tname = (sl.get("tour") or {}).get("name")
        if not tname:
            continue
        songs_list = [{"n": n, "e": e} for n, e in songs_of(sl)]
        if not songs_list:
            continue  # skip empty / setlist-less dates
        v = sl.get("venue", {})
        city = v.get("city", {})
        loc = ", ".join(filter(None, [city.get("name"), (city.get("stateCode") or ""),
                                      (city.get("country") or {}).get("name")]))
        d, m, y = sl["eventDate"].split("-")
        shows_by_tour[tname].append({
            "date": f"{y}-{m}-{d}",
            "venue": v.get("name", ""),
            "city": loc,
            "url": sl.get("url", ""),
            "songs": songs_list,
        })
    for t in shows_by_tour:
        shows_by_tour[t].sort(key=lambda s: s["date"])

    # ---- per-tour history (all tours, whole career)
    # song_tour[song][tour] = {plays, years}; tour_meta[tour] = {shows, years, song counts}
    song_tour = defaultdict(lambda: defaultdict(lambda: {"k": 0, "years": set()}))
    tour_meta = defaultdict(lambda: {"shows": 0, "years": set(), "songs": Counter()})
    for sl in sls:
        tname = (sl.get("tour") or {}).get("name")
        if not tname:
            continue
        yr = sl.get("eventDate", "")[-4:]
        yr = int(yr) if yr.isdigit() else None
        names = {n for n, _ in songs_of(sl)}
        if not names:
            continue
        tour_meta[tname]["shows"] += 1
        if yr:
            tour_meta[tname]["years"].add(yr)
        for n in names:
            tour_meta[tname]["songs"][n] += 1
            st = song_tour[n][tname]
            st["k"] += 1
            if yr:
                st["years"].add(yr)

    def yr_range(years):
        if not years:
            return ""
        lo, hi = min(years), max(years)
        return str(lo) if lo == hi else f"{lo}–{hi}"

    # each song -> tours it appeared on, oldest first
    song_tours = {}
    for n, tours in song_tour.items():
        rows = [{"t": t, "y": yr_range(d["years"]), "k": d["k"],
                 "_lo": min(d["years"]) if d["years"] else 0} for t, d in tours.items()]
        rows.sort(key=lambda r: r["_lo"])
        for r in rows:
            del r["_lo"]
        song_tours[n] = rows

    # each tour -> its songs by play count, newest tours first
    tours = []
    for t, d in tour_meta.items():
        tours.append({
            "t": t,
            "y": yr_range(d["years"]),
            "shows": d["shows"],
            "_hi": max(d["years"]) if d["years"] else 0,
            "songs": [{"n": n, "k": k} for n, k in d["songs"].most_common()],
        })
    tours.sort(key=lambda x: -x["_hi"])
    for x in tours:
        del x["_hi"]

    # ---- geography: cities/venues/countries with coords, counts, and per-place tour history
    city_index = {}          # setlist.fm city id -> our index
    cities = []              # [name, countryCode, lat, long, showCount]
    venue_counter = Counter()  # (venue, city, url) -> shows
    song_city = defaultdict(Counter)  # song -> {cityIdx: plays}
    city_tour = defaultdict(lambda: defaultdict(lambda: {"shows": 0, "years": set()}))
    venue_tour = defaultdict(lambda: defaultdict(lambda: {"shows": 0, "years": set()}))
    country_agg = {}
    for sl in sls:
        v = sl.get("venue") or {}
        city = v.get("city") or {}
        cid = city.get("id")
        if not cid:
            continue
        if cid not in city_index:
            co = city.get("coords") or {}
            city_index[cid] = len(cities)
            cities.append([city.get("name", ""), (city.get("country") or {}).get("code", ""),
                           round(co.get("lat", 0), 3), round(co.get("long", 0), 3), 0])
        idx = city_index[cid]
        cities[idx][4] += 1
        tname = (sl.get("tour") or {}).get("name")
        yr = sl.get("eventDate", "")[-4:]
        yr = int(yr) if yr.isdigit() else None
        if tname:
            ct = city_tour[idx][tname]; ct["shows"] += 1
            if yr: ct["years"].add(yr)
        vn = v.get("name")
        if vn:
            vkey = (vn, city.get("name", ""), v.get("url", ""))
            venue_counter[vkey] += 1
            if tname:
                vt = venue_tour[vkey][tname]; vt["shows"] += 1
                if yr: vt["years"].add(yr)
        ccode = (city.get("country") or {}).get("code", "")
        if ccode:
            ca = country_agg.setdefault(ccode, {"name": (city.get("country") or {}).get("name", ""),
                                                "shows": 0, "cities": set(),
                                                "tours": defaultdict(lambda: {"shows": 0, "years": set()})})
            ca["shows"] += 1
            ca["cities"].add(cid)
            if tname:
                cot = ca["tours"][tname]; cot["shows"] += 1
                if yr: cot["years"].add(yr)
        for n in {n for n, _ in songs_of(sl)}:
            song_city[n][idx] += 1

    song_geo = {n: [[i, c] for i, c in cc.most_common()] for n, cc in song_city.items()}

    def album_city(tracks):
        cc = Counter()
        for t in tracks:
            if t in SUITES:
                for n, m in song_city.items():
                    if n.startswith(t + " Part"):
                        cc.update(m)
            else:
                cc.update(song_city.get(ALIAS.get(t, t), {}))
        return [[i, c] for i, c in cc.most_common()]

    album_geo = [album_city(tr) for _, _, tr in ALBUMS]

    def tour_rows(dmap):
        rows = [[t, yr_range(d["years"]), d["shows"]] for t, d in dmap.items()]
        rows.sort(key=lambda r: -r[2])
        return rows

    city_tours = [tour_rows(city_tour.get(i, {})) for i in range(len(cities))]
    venues_full = sorted(
        [{"n": k[0], "c": k[1], "url": k[2], "sh": venue_counter[k], "t": tour_rows(venue_tour.get(k, {}))}
         for k in venue_counter],
        key=lambda x: -x["sh"])[:120]  # surface the most-played venues; UI lists a subset
    countries_list = sorted(
        [{"code": cc, "n": ca["name"], "sh": ca["shows"], "cities": len(ca["cities"]), "t": tour_rows(ca["tours"])}
         for cc, ca in country_agg.items()],
        key=lambda x: -x["sh"])

    geo = {"cities": cities, "cityTours": city_tours, "venues": venues_full, "countries": countries_list}

    out = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": "setlist.fm API",
        "complete": complete,
        "shows_counted": len(sls),
        "shows_total": total,
        "songs": songs,
        "albums": albums,
        "never": never,
        "leader": leader,
        "tour": tour_shows,
        "freq": freq_list,
        "songTours": song_tours,
        "tours": tours,
        "geo": geo,
        "songGeo": song_geo,
        "albumGeo": album_geo,
    }
    out_path = os.environ.get("SETLIST_OUT", "src/rush-data.json")
    Path(out_path).write_text(json.dumps(out, separators=(",", ":")))

    # per-show setlists go in a sibling file, loaded on demand by the Tours tab
    shows_path = str(Path(out_path).with_name("tour-shows.json"))
    Path(shows_path).write_text(json.dumps(dict(shows_by_tour), separators=(",", ":")))

    print(f"\nWrote {out_path}")
    print(f"  {len(songs)} distinct songs, top: {songs[0]['n']} ({songs[0]['c']})")
    print(f"  {len(never)} studio tracks never played")
    print(f"  {len(tour_shows)} {CURRENT_TOUR} shows, {len(freq_list)} unique songs this tour")
    print(f"Wrote {shows_path}")
    print(f"  {len(shows_by_tour)} tours with per-show setlists, "
          f"{sum(len(v) for v in shows_by_tour.values())} shows total")

    if "--inject" in sys.argv:
        target = Path(sys.argv[sys.argv.index("--inject") + 1])
        src = target.read_text()
        import re
        for const, val in [
            ("SONGS", out["songs"]), ("ALBUMS", out["albums"]), ("NEVER", out["never"]),
            ("LEADER", out["leader"]), ("TOUR", out["tour"]), ("FREQ", out["freq"]),
        ]:
            src = re.sub(
                rf"^const {const} = .*?;$",
                f"const {const} = {json.dumps(val, separators=(',', ':'))};",
                src, count=1, flags=re.M | re.S,
            )
        target.write_text(src)
        print(f"  injected fresh data into {target}")


if __name__ == "__main__":
    main()
