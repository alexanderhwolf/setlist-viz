import { useState, useEffect, useMemo } from "react";
import data from "./rush-data.json";
import WORLD from "./world-land.json";

const SONGS = data.songs;
const ALBUMS = data.albums;
const NEVER = data.never;
const LEADER = data.leader;
const TOUR = data.tour;
const FREQ = data.freq;
const SONGTOURS = data.songTours || {};
const TOURS = data.tours || [];
const GEO = data.geo || { cities: [], venues: [], countries: [], cityTours: [] };
const CITIES = GEO.cities;            // [name, countryCode, lat, long, showCount]
const CITYTOURS = GEO.cityTours || [];// aligned to CITIES: [[tour, years, shows], ...]
const VENUES = GEO.venues || [];      // [{n, c, url, sh, t:[[tour,years,shows]]}]
const COUNTRIES = GEO.countries || [];// [{code, n, sh, cities, t:[[tour,years,shows]]}]
const SONGGEO = data.songGeo || {};   // song -> [[cityIdx, count], ...]
const ALBUMGEO = data.albumGeo || []; // aligned to ALBUMS
const GENERATED = data.generated;

const MAX = SONGS[0].c;
const N = SONGS.length;
const NSHOWS = TOUR.length;
const LEADMAX = LEADER[0].t;
const CURRENT_TOUR = "Fifty Something Tour";

function rarity(c) {
  if (c === 0) return { label: "No live record", color: "#7a8397" };
  if (c >= 800) return { label: "Staple", color: "#e06a4f" };
  if (c >= 300) return { label: "Regular", color: "#e0a24f" };
  if (c >= 100) return { label: "Occasional", color: "#6fa8dc" };
  if (c >= 20) return { label: "Rare", color: "#a48fe0" };
  return { label: "Unicorn", color: "#5dcaa5" };
}

const pad2 = (n) => String(n).padStart(2, "0");

const fmtDate = (iso) => {
  const [, m, d] = iso.split("-");
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1];
  return `${mo} ${+d}`;
};

function useCountUp(target) {
  const [n, setN] = useState(target);
  useEffect(() => {
    const dur = 600, t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return n;
}

function Dial() {
  return (
    <svg width="300" height="300" viewBox="0 0 300 300" fill="none" aria-hidden="true">
      <circle cx="150" cy="150" r="126" stroke="rgba(176,197,228,.09)" />
      <circle cx="150" cy="150" r="94" stroke="rgba(176,197,228,.15)" />
      <circle cx="150" cy="150" r="66" stroke="rgba(224,106,79,.28)" />
      <ellipse cx="150" cy="150" rx="126" ry="44" stroke="rgba(176,197,228,.10)" />
      <path d="M2 150 C 58 100, 100 100, 150 150 S 242 200, 298 150"
            stroke="rgba(233,237,246,.5)" strokeWidth="1.3" />
      <g stroke="rgba(176,197,228,.45)" strokeWidth="1">
        <path d="M100 110 L126 80 L164 90 L194 126 L178 174 L126 180 Z" />
      </g>
      <g fill="#e9edf6">
        <circle cx="100" cy="110" r="1.8" /><circle cx="126" cy="80" r="2.2" />
        <circle cx="164" cy="90" r="1.8" /><circle cx="194" cy="126" r="1.8" />
        <circle cx="178" cy="174" r="1.8" /><circle cx="126" cy="180" r="1.8" />
      </g>
      <circle cx="150" cy="150" r="5" fill="#0a0d16" stroke="#e06a4f" strokeWidth="1.5" />
    </svg>
  );
}

const MW = 720, MH = 268, LAT_TOP = 78, LAT_BOT = -56;
const projX = (lng) => ((lng + 180) / 360) * MW;
const projY = (lat) => ((LAT_TOP - lat) / (LAT_TOP - LAT_BOT)) * MH;
const COAST = WORLD.arcs
  .map((a) => "M" + a.map(([lng, lat]) => `${projX(lng).toFixed(1)} ${projY(lat).toFixed(1)}`).join("L"))
  .join("");

// [cityIdx, count] list -> [lng, lat, weight] points for the map
const geoPoints = (list) => list.map(([i, c]) => [CITIES[i][3], CITIES[i][2], c]);
const geoStats = (list) => {
  const countries = new Set(list.map(([i]) => CITIES[i][1]));
  return { cities: list.length, countries: countries.size };
};

function HeatMap({ points, hint }) {
  const mx = Math.max(1, ...points.map((p) => p[2]));
  const sorted = [...points].sort((a, b) => a[2] - b[2]); // big dots drawn last
  return (
    <div className="panel" style={{ padding: 8, overflow: "hidden" }}>
      <svg viewBox={`0 0 ${MW} ${MH}`} width="100%" style={{ display: "block" }} aria-hidden="true">
        <path d={COAST} fill="none" stroke="rgba(176,197,228,.16)" strokeWidth="0.8" />
        {sorted.map((p, i) => {
          const f = Math.sqrt(p[2] / mx);
          return (
            <circle key={i} cx={projX(p[0]).toFixed(1)} cy={projY(p[1]).toFixed(1)}
                    r={(1 + f * 5).toFixed(1)} fill="#e8623f"
                    opacity={(0.6 + 0.35 * f).toFixed(2)}
                    stroke="rgba(8,11,18,.55)" strokeWidth="0.5" />
          );
        })}
      </svg>
      {hint && <div className="mono" style={{ fontSize: 9, color: "var(--faint)", textAlign: "center", margin: "6px 0 2px", letterSpacing: "0.12em" }}>{hint}</div>}
    </div>
  );
}

function InfoPanel({ onClose }) {
  return (
    <div className="panel" style={{ padding: 20, marginBottom: 20, fontSize: 13, lineHeight: 1.7, color: "var(--dim)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <span className="eyebrow" style={{ color: "var(--ink)" }}>About this data</span>
        <button onClick={onClose} aria-label="Close"
                style={{ background: "none", border: 0, color: "var(--dim)", fontSize: 20, lineHeight: 1, cursor: "pointer", marginTop: -4 }}>×</button>
      </div>
      <p style={{ margin: "0 0 10px" }}>
        <span style={{ color: "var(--ink)" }}>Source.</span>{" "}
        Setlist data from{" "}
        <a href="https://www.setlist.fm/setlists/rush-13d6dd1d.html" target="_blank" rel="noreferrer"
           style={{ color: "var(--ember2)" }}>setlist.fm</a>, used with permission via their official API. A count is
        the number of documented concerts including that song, from Rush&rsquo;s earliest logged shows through the
        current Fifty Something tour. Last refreshed {GENERATED}.
      </p>
      <p style={{ margin: "0 0 10px" }}>
        <span style={{ color: "var(--ink)" }}>Fan-submitted, so uneven.</span> Coverage of the 1990s&ndash;2010s
        arena tours is near-complete; 1970s club shows are patchy, so early songs are probably undercounted.
      </p>
      <p style={{ margin: "0 0 10px" }}>
        <span style={{ color: "var(--ink)" }}>&ldquo;No live record&rdquo;</span> means no documented performance
        &mdash; not proof it never happened.
      </p>
      <p style={{ margin: 0 }}>
        <span style={{ color: "var(--ink)" }}>Scope.</span> Album views cover the 19 studio albums (165 tracks).
        Song search covers all setlist.fm entries, including covers, medleys and solos. Tour history spans all
        {" "}{TOURS.length} documented tours.
      </p>
    </div>
  );
}

function SongRow({ s, index, onClick }) {
  return (
    <button className="row" onClick={onClick}>
      {index != null && <span className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 30, flexShrink: 0 }}>{index}</span>}
      <span className="row-name">{s.n}{s.s ? <span style={{ color: "var(--faint)", fontSize: 12 }}> (suite)</span> : null}</span>
      <span className={`row-val${s.c === 0 ? " zero" : ""}`}>{s.c === 0 ? "never" : (s.c ?? s.k)}</span>
    </button>
  );
}

export default function App() {
  const [tab, setTab] = useState("songs");
  const [songView, setSongView] = useState("most");
  const [detail, setDetail] = useState(false);
  const [query, setQuery] = useState("");
  const [song, setSong] = useState(() => SONGS.find((s) => s.n === "Tom Sawyer") || SONGS[0]);
  const [barW, setBarW] = useState(0);
  const [albumIdx, setAlbumIdx] = useState(7);
  const [tourIdx, setTourIdx] = useState(0);
  const [info, setInfo] = useState(false);
  const [showIdx, setShowIdx] = useState(null);
  const [atlasView, setAtlasView] = useState("city");
  const [place, setPlace] = useState(null);

  const count = useCountUp(song.c);

  useEffect(() => {
    setBarW(0);
    const t = setTimeout(() => setBarW(song.c === 0 ? 0 : Math.max(1.5, (song.c / MAX) * 100)), 40);
    return () => clearTimeout(t);
  }, [song]);

  const choose = (s) => {
    const full = SONGS.find((x) => x.n === s.n);
    setSong(full ? { ...full, s: s.s } : { ...s, r: null, c: s.c ?? 0 });
    setTab("songs");
    setDetail(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goTab = (t) => { setTab(t); setDetail(false); setPlace(null); };
  const openPlace = (p) => { setPlace(p); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SONGS.filter((s) => s.n.toLowerCase().includes(q)).slice(0, 60);
  }, [query]);

  const album = ALBUMS[albumIdx];
  const ranked = useMemo(() => [...album.tracks].sort((a, b) => b.c - a.c), [albumIdx]);
  const albumTotal = album.tracks.reduce((a, b) => a + b.c, 0);
  const albumNever = album.tracks.filter((t) => t.c === 0).length;

  const neverByAlbum = useMemo(() => {
    const m = new Map();
    NEVER.forEach((s) => {
      if (!m.has(s.a)) m.set(s.a, { year: s.y, songs: [] });
      m.get(s.a).songs.push(s.n);
    });
    return [...m.entries()];
  }, []);

  const activeTour = TOURS[tourIdx] || TOURS[0];
  const tourMax = activeTour ? Math.max(...activeTour.songs.map((s) => s.k)) : 1;

  const atlasPoints = useMemo(() => CITIES.map((c) => [c[3], c[2], c[4]]), []);
  const atlasCountries = useMemo(() => new Set(CITIES.map((c) => c[1])).size, []);
  const atlasShows = useMemo(() => CITIES.reduce((s, c) => s + c[4], 0), []);
  const cityRanked = useMemo(
    () => CITIES.map((c, i) => ({ i, n: c[0], cc: c[1], sh: c[4] })).sort((a, b) => b.sh - a.sh).slice(0, 80),
    []
  );

  const r = rarity(song.c);
  const pctl = song.r ? Math.round((1 - (song.r - 1) / N) * 100) : 0;
  const tourFreq = useMemo(() => new Map(FREQ.map((f) => [f.n, f.k])), []);
  const songTour = tourFreq.get(song.n) || 0;
  const playedOn = SONGTOURS[song.n] || [];
  const songGeoList = SONGGEO[song.n] || [];

  const eyebrow = (t) => <div className="eyebrow" style={{ margin: "0 4px 8px" }}>{t}</div>;
  const subtab = (k, label, cur, set) => (
    <button className={`tab${cur === k ? " on" : ""}`} onClick={() => set(k)}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "34px 16px 60px" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>

        <a href="https://inkmeetsdata.com/" target="_blank" rel="noopener noreferrer"
           style={{ display: "block", textAlign: "center", textDecoration: "none",
                    paddingBottom: 16, marginBottom: 20, borderBottom: "1px solid var(--line)" }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: "0.24em", textTransform: "uppercase", color: "var(--dim)" }}>Brought to you by</div>
          <div style={{ fontFamily: "'Michroma', sans-serif", fontSize: 23, color: "var(--ink)", marginTop: 8, lineHeight: 1 }}>
            I<span style={{ color: "var(--teal)" }}>∧</span>D
          </div>
          <div className="mono" style={{ fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--dim)", marginTop: 9 }}>Ink Meets Data</div>
        </a>

        <header style={{ textAlign: "center", marginBottom: 22 }}>
          <div className="stamp">Performance Index</div>
          <h1 className="tracked" style={{ fontSize: 25, fontWeight: 600, letterSpacing: "0.12em", lineHeight: 1.25, margin: "12px 0 0" }}>
            How many times has<br /><span style={{ color: "var(--ember2)" }}>Rush</span> played it live?
          </h1>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 12 }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--dim)" }}>1974 — 2026</span>
            <button onClick={() => setInfo((v) => !v)} aria-label="About this data" aria-expanded={info}
                    style={{ width: 20, height: 20, borderRadius: "50%", background: info ? "rgba(201,76,60,.12)" : "transparent",
                             border: `1px solid ${info ? "#e06a4f" : "var(--line-strong)"}`, color: info ? "#e06a4f" : "var(--dim)",
                             fontFamily: "Space Mono, monospace", fontSize: 11, fontStyle: "italic", cursor: "pointer", lineHeight: 1 }}>i</button>
          </div>
        </header>

        {info && <InfoPanel onClose={() => setInfo(false)} />}

        <div className="tabbar" style={{ marginBottom: 20 }}>
          {[["songs", "Songs"], ["albums", "Albums"], ["tours", "Tours"], ["atlas", "Atlas"]].map(([k, label]) => (
            <button key={k} className={`tab${tab === k ? " on" : ""}`} onClick={() => goTab(k)}>{label}</button>
          ))}
        </div>

        {/* ---------------- SONGS ---------------- */}
        {tab === "songs" && detail && (
          <>
            <button className="gbtn" onClick={() => setDetail(false)}
                    style={{ flex: "none", padding: "8px 14px", marginBottom: 14 }}>‹ Back to songs</button>

            <div className="panel" style={{ padding: "26px 22px", textAlign: "center" }}>
              <div className="tracked-sm" style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.3, marginBottom: 10 }}>{song.n}</div>
              <span className="badge" style={{ color: r.color }}>{r.label}</span>

              <div className="instrument">
                <Dial />
                <div className="readout">
                  {song.c === 0 ? <div className="num muted">0</div> : <div className="num">{count.toLocaleString()}</div>}
                  <div className="unit">{song.c === 0 ? "Studio track only" : "Times played live"}</div>
                </div>
              </div>

              {song.c > 0 && (
                <>
                  <div className="track" style={{ margin: "6px 0 8px" }}>
                    <div className="fill" style={{ width: `${barW}%` }} />
                  </div>
                  <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: "0.06em", color: "var(--dim)", marginBottom: 22 }}>
                    <span>{((song.c / MAX) * 100).toFixed(1)}% of #1</span>
                    <span>{song.r === 1 ? "most played" : `${(MAX - song.c).toLocaleString()} behind #1`}</span>
                  </div>
                </>
              )}

              <div className="coords" style={{ marginTop: song.c > 0 ? 0 : 22, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                <div className="coord" style={{ textAlign: "left" }}>
                  <div className="k">Rank</div>
                  <div className="v">{song.r ? <><b>{pad2(song.r)}</b>°/{N}</> : <span className="dim">—</span>}</div>
                </div>
                <div className="coord" style={{ textAlign: "center" }}>
                  <div className="k">Percentile</div>
                  <div className="v">{song.r ? <><b>{pad2(pctl)}</b>′00″</> : <span className="dim">—</span>}</div>
                </div>
                <div className="coord" style={{ textAlign: "right" }}>
                  <div className="k">This tour</div>
                  <div className="v"><b>{pad2(songTour)}</b>/{NSHOWS}</div>
                </div>
              </div>
            </div>

            {playedOn.length > 0 && (
              <>
                {eyebrow("Plays by tour")}
                <div className="panel" style={{ overflow: "hidden" }}>
                  {playedOn.map((t) => (
                    <div key={t.t} className="row" style={{ cursor: "default" }}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--dim)", width: 74, flexShrink: 0 }}>{t.y}</span>
                      <span className="row-name" style={{ fontSize: 13 }}>{t.t}</span>
                      <span className="row-val">{t.k}</span>
                    </div>
                  ))}
                  {(() => {
                    const psum = playedOn.reduce((a, t) => a + t.k, 0);
                    const untag = Math.max(0, song.c - psum);
                    return untag > 0 ? (
                      <div className="row" style={{ cursor: "default" }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 74, flexShrink: 0 }}>—</span>
                        <span className="row-name" style={{ fontSize: 13, color: "var(--dim)" }}>No named tour</span>
                        <span className="row-val zero">{untag}</span>
                      </div>
                    ) : null;
                  })()}
                </div>
              </>
            )}
            {song.c > 0 && playedOn.length === 0 && (
              <p className="mono" style={{ fontSize: 10, color: "var(--faint)", textAlign: "center", marginTop: 16 }}>
                Performances not attributed to a named tour.
              </p>
            )}

            {songGeoList.length > 0 && (() => {
              const st = geoStats(songGeoList);
              return (
                <>
                  <div style={{ marginTop: 24 }}>{eyebrow(`Where it's been played`)}</div>
                  <HeatMap points={geoPoints(songGeoList)}
                           hint={`${st.cities} cities · ${st.countries} countries`} />
                </>
              );
            })()}
          </>
        )}

        {tab === "songs" && !detail && (
          <>
            <div className="tabbar" style={{ marginBottom: 16 }}>
              {subtab("search", "Search", songView, setSongView)}
              {subtab("most", "Most plays", songView, setSongView)}
              {subtab("never", "Never", songView, setSongView)}
            </div>

            {songView === "search" && (
              <>
                <input className="field" value={query} placeholder="SEARCH 170 SONGS"
                       onChange={(e) => setQuery(e.target.value)} autoFocus />
                {query.trim() === "" ? (
                  <p className="mono" style={{ fontSize: 11, color: "var(--faint)", textAlign: "center", marginTop: 22 }}>
                    Type a title — e.g. Xanadu, YYZ, Freewill.
                  </p>
                ) : (
                  <div className="panel" style={{ marginTop: 14, overflow: "hidden" }}>
                    {searchResults.length === 0
                      ? <div style={{ padding: 16, color: "var(--dim)", fontSize: 13, textAlign: "center" }}>No match.</div>
                      : searchResults.map((s) => <SongRow key={s.n} s={s} index={s.r ? pad2(s.r) : "—"} onClick={() => choose(s)} />)}
                  </div>
                )}
              </>
            )}

            {songView === "most" && (
              <>
                {eyebrow(`All ${N} songs · most played first`)}
                <div className="panel" style={{ overflow: "hidden" }}>
                  {SONGS.map((s) => <SongRow key={s.n} s={s} index={pad2(s.r)} onClick={() => choose(s)} />)}
                </div>
              </>
            )}

            {songView === "never" && (
              <>
                <div className="panel" style={{ padding: 20, textAlign: "center", marginBottom: 20 }}>
                  <div className="num" style={{ fontSize: 42 }}>{NEVER.length}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--dim)", marginTop: 10, lineHeight: 1.7, letterSpacing: "0.06em" }}>
                    studio tracks with no documented<br />live performance · 165 across 19 albums
                  </div>
                </div>
                {neverByAlbum.map(([name, i]) => (
                  <div key={name} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 4px 8px" }}>
                      <span className="tracked-sm" style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{i.year} · {pad2(i.songs.length)}</span>
                    </div>
                    <div className="panel" style={{ overflow: "hidden" }}>
                      {i.songs.map((s) => (
                        <div key={s} style={{ padding: "10px 16px", fontSize: 14, color: "var(--dim)", borderBottom: "1px solid var(--line)" }}>{s}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ---------------- ALBUMS ---------------- */}
        {tab === "albums" && (
          <>
            {eyebrow("Album leaderboard · total live plays")}
            <div className="panel" style={{ padding: 16 }}>
              {LEADER.map((a) => (
                <button key={a.a} onClick={() => setAlbumIdx(a.i)}
                        style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", padding: "7px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                    <span className="tracked-sm" style={{ fontSize: 11, color: a.i === albumIdx ? "#e06a4f" : "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.a} <span style={{ color: "var(--dim)" }}>&rsquo;{String(a.y).slice(2)}</span>
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--ember2)" }}>{a.t.toLocaleString()}</span>
                  </div>
                  <div className="track" style={{ height: 5 }}>
                    <div className={`fill${a.i === albumIdx ? " solid" : ""}`} style={{ width: `${Math.max(0.8, (a.t / LEADMAX) * 100)}%` }} />
                  </div>
                </button>
              ))}
            </div>

            {eyebrow("Track detail")}
            <select className="field" value={albumIdx} onChange={(e) => setAlbumIdx(+e.target.value)}>
              {ALBUMS.map((a, i) => <option key={a.a} value={i}>{a.a} ({a.y})</option>)}
            </select>

            <div className="coords" style={{ marginTop: 12, gap: 8 }}>
              {[["Tracks", album.tracks.length], ["Total plays", albumTotal.toLocaleString()], ["Never", albumNever]].map(([k, v], i) => (
                <div key={k} className="panel coord" style={{ padding: "12px 10px", textAlign: "center" }}>
                  <div className="v" style={{ fontSize: 18, marginTop: 0, color: i === 1 ? "var(--ember2)" : "var(--ink)" }}>{v}</div>
                  <div className="k" style={{ marginTop: 4 }}>{k}</div>
                </div>
              ))}
            </div>

            <div className="panel" style={{ marginTop: 12, overflow: "hidden" }}>
              {ranked.map((t, i) => <SongRow key={t.n} s={t} index={pad2(i + 1)} onClick={() => choose(t)} />)}
            </div>

            {ALBUMGEO[albumIdx] && ALBUMGEO[albumIdx].length > 0 && (() => {
              const list = ALBUMGEO[albumIdx];
              const st = geoStats(list);
              return (
                <>
                  <div style={{ marginTop: 24 }}>{eyebrow(`${album.a} · live heat map`)}</div>
                  <HeatMap points={geoPoints(list)} hint={`${st.cities} cities · ${st.countries} countries`} />
                </>
              );
            })()}
          </>
        )}

        {/* ---------------- TOURS ---------------- */}
        {tab === "tours" && activeTour && (
          <>
            <select className="field" value={tourIdx} onChange={(e) => { setTourIdx(+e.target.value); setShowIdx(null); }}>
              {TOURS.map((t, i) => <option key={t.t} value={i}>{t.t}{t.y ? ` (${t.y})` : ""}</option>)}
            </select>

            <div className="coords" style={{ marginTop: 12, gap: 8 }}>
              {[["Years", activeTour.y || "—", "#e9edf6"], ["Shows", activeTour.shows, "#e06a4f"], ["Songs", activeTour.songs.length, "#e0a24f"]].map(([k, v, c]) => (
                <div key={k} className="panel coord" style={{ padding: "12px 10px", textAlign: "center" }}>
                  <div className="v" style={{ fontSize: 16, marginTop: 0, color: c }}>{v}</div>
                  <div className="k" style={{ marginTop: 4 }}>{k}</div>
                </div>
              ))}
            </div>

            {eyebrow("Songs on this tour · most played first")}
            <div className="panel" style={{ overflow: "hidden" }}>
              {activeTour.songs.map((s, i) => (
                <button key={s.n} className="row" onClick={() => choose(s)}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 30, flexShrink: 0 }}>{pad2(i + 1)}</span>
                  <span className="row-name" style={{ fontSize: 13 }}>{s.n}</span>
                  <span className="row-val">{s.k}</span>
                </button>
              ))}
            </div>

            {activeTour.t === CURRENT_TOUR && NSHOWS > 0 && (
              <>
                <div style={{ marginTop: 24 }}>{eyebrow("Shows so far · tap for the setlist")}</div>
                <div className="panel" style={{ overflow: "hidden" }}>
                  {TOUR.map((s, i) => (
                    <div key={s.url || i} style={{ borderBottom: "1px solid var(--line)" }}>
                      <button className="row" style={{ borderBottom: 0 }} onClick={() => setShowIdx(showIdx === i ? null : i)}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--dim)", width: 48 }}>{fmtDate(s.date)}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 14, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.city.split(",").slice(0, -1).join(",") || s.city}
                          </span>
                          <span className="mono" style={{ display: "block", fontSize: 10, color: "var(--dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.venue}</span>
                        </span>
                        <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{pad2(s.songs.length)}</span>
                        <span style={{ color: "var(--faint)", fontSize: 11, transform: showIdx === i ? "rotate(90deg)" : "none", transition: "transform .18s" }}>▸</span>
                      </button>
                      {showIdx === i && (
                        <div style={{ padding: "2px 16px 16px", background: "rgba(8,11,18,.4)" }}>
                          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
                            {s.songs.map((x, j) => {
                              const prevEnc = j > 0 && s.songs[j - 1].e;
                              return (
                                <li key={j}>
                                  {x.e === 1 && !prevEnc && <div className="encore">Encore</div>}
                                  <button onClick={() => choose({ n: x.n })}
                                          style={{ display: "flex", gap: 8, width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", color: "var(--ink)", fontSize: 13, padding: "3px 0", fontFamily: "inherit" }}>
                                    <span className="mono" style={{ color: "var(--faint)", fontSize: 11, width: 22 }}>{pad2(j + 1)}</span>
                                    <span style={{ lineHeight: 1.35 }}>{x.n}</span>
                                  </button>
                                </li>
                              );
                            })}
                          </ol>
                          {s.url && (
                            <a href={s.url} target="_blank" rel="noreferrer" className="mono"
                               style={{ display: "inline-block", marginTop: 12, fontSize: 10, color: "var(--dim)", letterSpacing: "0.08em" }}>
                              VIEW ON SETLIST.FM
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mono" style={{ fontSize: 10, color: "var(--faint)", marginTop: 12, padding: "0 4px", lineHeight: 1.7, letterSpacing: "0.04em" }}>
                  The band alternates a 24-song and a 28-song set (the long one has the full 2112 suite), so many songs cluster near 50% across the {NSHOWS} shows logged.
                </p>
              </>
            )}
          </>
        )}

        {/* ---------------- ATLAS ---------------- */}
        {tab === "atlas" && place && (
          <>
            <button className="gbtn" onClick={() => setPlace(null)}
                    style={{ flex: "none", padding: "8px 14px", marginBottom: 14 }}>‹ Back to atlas</button>

            <div className="panel" style={{ padding: 20, textAlign: "center", marginBottom: 16 }}>
              <div className="stamp">{place.kind}</div>
              <div className="tracked-sm" style={{ fontSize: 18, fontWeight: 500, marginTop: 8, lineHeight: 1.3 }}>{place.title}</div>
              {place.sub && <div className="mono" style={{ fontSize: 10, color: "var(--dim)", marginTop: 6, letterSpacing: "0.1em" }}>{place.sub}</div>}
              <div className="coords" style={{ marginTop: 16, justifyContent: "center", gap: 40 }}>
                <div className="coord" style={{ flex: "none", textAlign: "center" }}>
                  <div className="v" style={{ fontSize: 22, color: "#e06a4f", marginTop: 0 }}>{place.shows}</div>
                  <div className="k" style={{ marginTop: 4 }}>Shows</div>
                </div>
                <div className="coord" style={{ flex: "none", textAlign: "center" }}>
                  <div className="v" style={{ fontSize: 22, color: "#e0a24f", marginTop: 0 }}>{place.tours.length}</div>
                  <div className="k" style={{ marginTop: 4 }}>Tours</div>
                </div>
              </div>
            </div>

            {place.kind === "country" && (
              <div style={{ marginBottom: 16 }}>
                <HeatMap points={CITIES.filter((c) => c[1] === place.cc).map((c) => [c[3], c[2], c[4]])} hint={place.sub} />
              </div>
            )}

            {(() => {
              const tsum = place.tours.reduce((a, t) => a + t[2], 0);
              const untag = Math.max(0, place.shows - tsum);
              return (
                <>
                  {eyebrow("Shows by tour")}
                  <div className="panel" style={{ overflow: "hidden" }}>
                    {place.tours.map((t) => (
                      <div key={t[0]} className="row" style={{ cursor: "default" }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--dim)", width: 74, flexShrink: 0 }}>{t[1]}</span>
                        <span className="row-name" style={{ fontSize: 13 }}>{t[0]}</span>
                        <span className="row-val">{t[2]}</span>
                      </div>
                    ))}
                    {untag > 0 && (
                      <div className="row" style={{ cursor: "default" }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 74, flexShrink: 0 }}>—</span>
                        <span className="row-name" style={{ fontSize: 13, color: "var(--dim)" }}>No named tour{" "}
                          <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>(early / one-off dates)</span>
                        </span>
                        <span className="row-val zero">{untag}</span>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
            {place.url && (
              <a href={place.url} target="_blank" rel="noreferrer" className="mono"
                 style={{ display: "inline-block", marginTop: 14, fontSize: 10, color: "var(--dim)", letterSpacing: "0.08em" }}>
                VIEW VENUE ON SETLIST.FM
              </a>
            )}
          </>
        )}

        {tab === "atlas" && !place && (
          <>
            {eyebrow("Every city Rush has played")}
            <HeatMap points={atlasPoints}
                     hint={`${CITIES.length} cities · ${atlasCountries} countries · ${atlasShows.toLocaleString()} shows`} />

            <div className="coords" style={{ marginTop: 12, gap: 8 }}>
              {[["Cities", CITIES.length, "#e9edf6"], ["Countries", atlasCountries, "#e0a24f"], ["Shows", atlasShows.toLocaleString(), "#e06a4f"]].map(([k, v, c]) => (
                <div key={k} className="panel coord" style={{ padding: "12px 10px", textAlign: "center" }}>
                  <div className="v" style={{ fontSize: 16, marginTop: 0, color: c }}>{v}</div>
                  <div className="k" style={{ marginTop: 4 }}>{k}</div>
                </div>
              ))}
            </div>

            <div className="tabbar" style={{ margin: "20px 0 16px" }}>
              {subtab("city", "City", atlasView, setAtlasView)}
              {subtab("country", "Country", atlasView, setAtlasView)}
              {subtab("venue", "Venue", atlasView, setAtlasView)}
            </div>

            {atlasView === "city" && (
              <>
                {eyebrow(`Top ${cityRanked.length} of ${CITIES.length} cities`)}
                <div className="panel" style={{ overflow: "hidden" }}>
                  {cityRanked.map((c, i) => (
                    <button key={c.i} className="row" onClick={() => openPlace({ kind: "city", title: c.n, sub: c.cc, shows: c.sh, tours: CITYTOURS[c.i] || [] })}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 30, flexShrink: 0 }}>{pad2(i + 1)}</span>
                      <span className="row-name">{c.n} <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>{c.cc}</span></span>
                      <span className="row-val">{c.sh}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {atlasView === "country" && (
              <>
                {eyebrow(`${COUNTRIES.length} countries`)}
                <div className="panel" style={{ overflow: "hidden" }}>
                  {COUNTRIES.map((co, i) => (
                    <button key={co.code} className="row" onClick={() => openPlace({ kind: "country", title: co.n, sub: `${co.cities} cities`, shows: co.sh, tours: co.t, cc: co.code })}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 30, flexShrink: 0 }}>{pad2(i + 1)}</span>
                      <span className="row-name">{co.n}</span>
                      <span className="row-val">{co.sh}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {atlasView === "venue" && (
              <>
                {eyebrow(`Top ${Math.min(VENUES.length, 80)} venues`)}
                <div className="panel" style={{ overflow: "hidden" }}>
                  {VENUES.slice(0, 80).map((v, i) => (
                    <button key={v.n + i} className="row" onClick={() => openPlace({ kind: "venue", title: v.n, sub: v.c, shows: v.sh, tours: v.t, url: v.url })}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--faint)", width: 30, flexShrink: 0 }}>{pad2(i + 1)}</span>
                      <span className="row-name">{v.n} <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>{v.c}</span></span>
                      <span className="row-val">{v.sh}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className="mono" style={{ fontSize: 10, color: "var(--faint)", marginTop: 16, padding: "0 4px", lineHeight: 1.7, letterSpacing: "0.04em" }}>
              Dot size scales with shows per city. Tap any city, country, or venue for the tours that visited it.
            </p>
          </>
        )}

        <footer className="mono" style={{ textAlign: "center", fontSize: 10, color: "var(--faint)", marginTop: 30, lineHeight: 1.8, letterSpacing: "0.04em", paddingBottom: 10 }}>
          Setlist data from{" "}
          <a href="https://www.setlist.fm" target="_blank" rel="noreferrer" style={{ textDecoration: "underline", color: "var(--dim)" }}>setlist.fm</a>, used with permission.{" "}
          <button onClick={() => { setInfo(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  style={{ background: "none", border: 0, color: "var(--dim)", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: 10, letterSpacing: "0.04em" }}>
            Sources &amp; caveats
          </button>
          <br />Not affiliated with Rush or setlist.fm · A data visualization by{" "}
          <a href="https://inkmeetsdata.com/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "var(--dim)" }}>
            <span style={{ fontFamily: "'Michroma', sans-serif", fontSize: 12, color: "var(--ink)" }}>I<span style={{ color: "var(--teal)" }}>∧</span>D</span>{" "}Ink Meets Data
          </a>.
        </footer>
      </div>
    </div>
  );
}
