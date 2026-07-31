# ruh-nonstop

An interactive map of **nonstop passenger destinations from Riyadh King Khalid International (RUH)**,
filterable by great-circle distance.

**Live:** https://bdulih.github.io/ruh-nonstop/

`index.html` is the whole thing: one self-contained file, no dependencies, no build step, no runtime
network calls. Open it from `file://` and it works.

---

## The design decision that matters

**There are no flight times, frequencies or fares anywhere in this file, and that is deliberate.**

Free schedule sources contradict each other badly. Riyadh–Cairo comes back as 133, 157 or 202 flights
per week and 1h58, 2h40 or 3h12 depending on who you ask. Caching any of those numbers produces
something that looks authoritative and is wrong within a week.

So the filter is **great-circle distance** instead. It is trigonometry on two coordinates: it is
ground truth, it never goes stale, and it answers the same underlying question — *how concentrated is
this network?* (Answer: heavily. The median destination is ~2,450 km out, and a quarter of all
destinations are inside Saudi Arabia.)

Anything genuinely schedule-shaped — which days, what time, how long — links out to a **live,
date-pinned Google Flights query** rather than being cached.

## Provenance

Every row is tagged with where it came from and how much to trust it. The tag is shown in the UI, in
the destination detail panel.

| Tag | Meaning |
|---|---|
| `wp-cited` | In the live Wikipedia "King Khalid International Airport" table **with an inline citation** to an independent source — mostly OAG Flight Guide Worldwide (May 2025) or an airline press release. Confidence: high. |
| `wp-uncited` | In the live Wikipedia table but tagged `{{citation needed}}`. Confidence: medium. |
| `restored` | Present in the 11 January 2026 revision, deleted since during Wikipedia's uncited-row purge, then **re-confirmed against an independent source**. Confidence: medium. |

### Why the `restored` tier exists

Wikipedia's KKIA passenger table listed **65 airlines in January 2026** and **44 today**. Editors have
been mass-deleting rows that lack an independent citation — the article carries the banner *"Please
use only independent sources"*, and 69 of the surviving 183 route entries are still `{{citation
needed}}`.

That purge removed Turkish Airlines, British Airways, Oman Air, Middle East Airlines, SriLankan,
Biman and others. Most of those deletions did **not** cost the map a destination, because the cities
they served (Istanbul, London, Muscat, Beirut, Colombo…) are still listed under other carriers. Only
a handful of *destinations* actually vanished, and each was researched individually before being
restored or dropped.

**Routes deliberately left out** because they could not be independently re-verified are listed in
the About panel inside the page. Never invent route data: if it could not be sourced, it is not on
the map, and the page says so.

## Data sources

| What | Source |
|---|---|
| Route list | English Wikipedia, [King Khalid International Airport](https://en.wikipedia.org/wiki/King_Khalid_International_Airport) — live revision + the 2026-01-11 revision |
| Destination → IATA | [Wikidata](https://www.wikidata.org) property **P238**, following redirects — never string-matched or guessed |
| Airport coordinates | [OpenFlights](https://github.com/jpatokal/openflights) `airports.dat` |
| Coordinates OpenFlights lacks | Wikidata property **P625** |
| Country boundaries | [world-atlas](https://github.com/topojson/world-atlas) `countries-110m` (Natural Earth 1:110m), decoded from TopoJSON in-page |

OpenFlights has not been meaningfully updated since ~2017, so it has no row at all for **NUM**
(NEOM Bay, 2019), **RSI** (Red Sea, 2023), **SPX** (Sphinx, 2020) or **RZV** (Rize–Artvin, 2022).
Those four take coordinates from Wikidata P625 and are tagged as such in the UI. None were guessed.

## Geometry

- **Projection:** Miller cylindrical, `y = 1.25·ln(tan(π/4 + 0.4φ))`, latitude clamped to ±84°.
- **Distance:** haversine, R = 6371.0088 km.
- **Routes:** true great circles, 48-point spherical interpolation, with the path broken wherever it
  crosses the antimeridian.

Reference distances — these are asserted at build time and the build fails if any drifts:

```
RUH–JED   852 km
RUH–DXB   873 km
RUH–CAI  1612 km
RUH–LHR  4941 km
```

## Known limits

- Schedules change constantly. A listed route may be suspended tomorrow.
- Seasonal routes are flagged but the season is not modelled — a summer-only route shows year-round.
- Routes with a future start date are flagged `soon` and are drawn on the map.
- Codeshares excluded; only the operating carrier is listed. No cargo-only routes.
- At 1:110m there is no polygon for Bahrain, Hong Kong, Singapore or the Maldives, so those appear as
  a dot with no landmass. That is the source resolution, not a bug.

## Rebuilding

`index.html` is generated, but it is committed and is the deliverable — you never need to run this.

```sh
python3 build.py     # reads data/, writes index.html
```

The destination table lives in one array at the top of the `<script>` block in `index.html`
(`DESTINATIONS`), so a row can be added or corrected there directly without touching any rendering
code. `data/` holds the pinned upstream inputs so the build is reproducible offline.
