# ruh-nonstop

An interactive map of **nonstop passenger destinations from Riyadh King Khalid International (RUH)**,
filterable by **estimated flight time**, with typical fare bands.

**Live:** https://bdulih.github.io/ruh-nonstop/

`index.html` is the whole thing: one self-contained file, no dependencies, no build step, no runtime
network calls. Open it from `file://` and it works.

---

## Flight times are derived, not cached

**No schedule data is stored in this file.** Free schedule sources contradict each other badly:
Riyadh–Cairo comes back as 133, 157 or 202 flights per week and 1h58, 2h40 or 3h12 depending on who
you ask. Caching any of that produces something that looks authoritative and is wrong within a week.

So flight time is **derived from great-circle distance** — a fixed half hour on the ground for taxi,
climb and descent, plus cruise at 780 km/h block speed:

```
hours = 0.5 + km / 780
```

That is deterministic, so it never goes stale. It lands within about ±15%:

| Route | km | Model | Typical actual |
|---|---|---|---|
| RUH–JED | 852 | 1h35 | ~1h45 |
| RUH–DXB | 873 | 1h37 | ~1h50 |
| RUH–CAI | 1,612 | 2h34 | ~2h35 |
| RUH–LHR | 4,941 | 6h50 | ~6h45 |

It is an estimate of a typical nonstop, not a timetable — it knows nothing about winds, routings or
the aircraft. The median destination is **3h42** out and a fifth of them are inside Saudi Arabia.

## Fares are sampled bands, not quotes

Fares were sampled from live queries on **2026-07-31**, one anchor route per time band, and the band
is applied to every route in it. They are **return economy ranges for a band, not quotes for a
route**, and they will drift — fares move faster than schedules.

| Band | Typical return | Anchor |
|---|---|---|
| under 2h | SAR 300–700 | RUH–JED: flyadeal from SAR 299, flynas from SAR 329 one-way |
| 2–4h | SAR 650–1,500 | RUH–CAI: best return SAR 670, typical 840–1,416 |
| 4–7h | SAR 900–2,900 | RUH–DEL 964, RUH–IST 1,311–2,871, RUH–LHR 1,315–1,760 |
| 7h+ | SAR 2,400–4,100 | RUH–MNL from 2,401; RUH–JFK ~USD 590–1,097 at 3.75 |

Routes with a low-cost carrier are flagged separately, because that moves the real fare more than
distance does at the short end. Every destination links out to a **live, date-pinned Google Flights
search** for the actual number.

### The links really are nonstop-only

Putting the word "nonstop" in a Google Flights `q=` text search does not work. Google parses the route
from it and then shows one-stop itineraries anyway. The stops filter only applies through the `tfs`
parameter, which is a base64url-encoded protobuf, so the page builds that by hand:

```
Info { repeated FlightData data = 3; passengers = 8; seat = 9; trip = 19 }
FlightData { max_stops = 5; date = 2; Airport from = 13; Airport to = 14 }
Airport { code = 2 }
```

`max_stops = 0` is the nonstop filter; `trip` is 1 for a return and 2 for one way. Verified against
Google rather than assumed — on RUH–LAX, which has no nonstop service, the unfiltered search returns
70 "1 stop" results and the filtered one returns zero; RUH–DXB returns 222 nonstop and zero one-stop.
A malformed `tfs` falls back to the Google Flights homepage, which is how the encoder is checked.

### Dates are only pinned when the route flies daily

Pinning a Thursday is a coin flip on a route that runs three times a week — Guangzhou flies
Mon/Wed/Fri, so a pinned Thursday lands on a day with no nonstop at all, which reads as a broken link.

There is no reliable public source for day-of-week here, and it could not be measured either: `curl`
only receives the JavaScript shell, and the counts in that HTML are template noise, not flight data.
Tested against Kuala Lumpur, whose Tue/Thu/Sat schedule is sourced, the naive detector returned the
exact inverse — so it was thrown away rather than shipped.

So the rule is: **daily routes get pinned dates, everything else does not.**

- **Daily** (7+/week): dates pinned to the Saudi **Friday–Saturday weekend** — out Thursday, back
  Saturday for a short hop, Sunday for a long weekend, a week later for anything over 7 hours, because
  a weekend in Atlanta at 15h30 each way is not a real suggestion.
- **Anything less, or unknown**: a **dateless** nonstop search, so Google's own calendar shows which
  days actually have a nonstop and you pick from those.

CI asserts both halves — a daily route must carry a date, and a non-daily route must not.

## Provenance

Every row is tagged with where it came from and how much to trust it. The tag is shown in the UI, in
the destination detail panel.

| Tag | Meaning |
|---|---|
| `wp-cited` | In the live Wikipedia "King Khalid International Airport" table **with an inline citation** to an independent source — mostly OAG Flight Guide Worldwide (May 2025) or an airline press release. Confidence: high. |
| `wp-uncited` | In the live Wikipedia table but tagged `{{citation needed}}`. Confidence: medium. |
| `restored` | Deleted from Wikipedia during the uncited-row purge, then **re-confirmed against an independent source** — the other endpoint's airport article, an airline's own booking engine or network release, AeroRoutes, or a schedule aggregator. Per-route evidence is in `data/verified.json` and shown in the UI. |

The same pass also **removed** two destinations Wikipedia still lists (Bangkok–Don Mueang, whose only
operator suspended indefinitely with no resumption filed; and Larnaca, absent from the airport's own
listing at peak season) and flagged Amsterdam as suspended until 6 September 2026. Routes checked and
deliberately left off — Izmir, Yerevan, Santorini, Kathmandu, Tivat, Baghdad and others — are recorded
with their reasons in `data/verified.json` so the omissions are visible rather than silent.

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

## Shipping

Built to be handed to a lot of people and then left alone.

**Browsers.** The QA suite runs on **Chromium, Firefox and WebKit** — WebKit being the engine behind
iOS Safari, which for a Riyadh audience is most of the traffic — across desktop, laptop, tablet and
phone viewports. Cross-engine testing caught three real defects that Chromium alone did not:
`setPointerCapture` throwing in Firefox and silently killing selection, a modal that could not be
dismissed with Escape once focus was in the search field, and a missing `100vh` fallback that would
have broken layout on Safari before 15.4.

**Weight.** 217 KB raw, **68 KB gzipped**, one request. CI fails the build if the gzipped payload goes
over 100 KB. Ready to interact in ~210 ms; a filter re-render costs ~2.7 ms and a zoom step ~0.9 ms,
across 129 routes and 177 country polygons.

**Degradation.** `<noscript>` explains the page and links to the data. The boot sequence is wrapped so
a map failure leaves the list working rather than white-screening. Modal focus is trapped and
restored, Escape always closes, and `prefers-reduced-motion` is honoured.

**Staleness.** This is the thing that actually rots. The page carries its own build date and, once the
data is more than 90 days old, says so in the header rather than ageing quietly into being wrong. CI
re-checks weekly and warns on the same threshold.

**CI** (`.github/workflows/qa.yml`) runs on every push, every PR, and weekly. It verifies that
`index.html` is exactly what `build.py` produces from `data/` — so the committed deliverable can never
drift from its inputs — then runs all three engines, the weight budget, and the freshness check.

## Known limits

- Schedules change constantly. A listed route may be suspended tomorrow.
- Seasonal routes are flagged but the season is not modelled — a summer-only route shows year-round.
- Routes with a future start date are flagged `soon` and are drawn on the map.
- Codeshares excluded; only the operating carrier is listed. No cargo-only routes.
- At 1:110m there is no polygon for Bahrain, Hong Kong, Singapore or the Maldives, so those appear as
  a dot with no landmass. That is the source resolution, not a bug.
- English only. A meaningful share of the audience reads Arabic, and an RTL Arabic version would be a
  real improvement — it is not built.
- Fare bands are sampled per time band, not per route, so a route can sit well outside its band.

## Rebuilding and testing

`index.html` is generated, but it is committed and is the deliverable — you never need to run this.

```sh
python3 build.py                 # reads data/, writes index.html
QA_ENGINE=chromium node qa.js    # also: firefox, webkit
```

`build.py` fails the build rather than emitting bad data: it asserts the four reference distances, and
refuses to guess a coordinate, country or region it does not have.

`qa.js` drives the real page across four viewports (desktop, laptop, tablet, phone) in whichever
engine `QA_ENGINE` names — touch contexts are driven with touch, since Firefox emits no pointer events
from synthetic mouse input once `hasTouch` is set:

- **Layer 1 — functional.** Every control on desktop, laptop, tablet and phone: map-dot selection,
  list selection, the hour filter, region chips, search, collapsible groups, empty state, zoom
  counter-scaling, and the mobile sheet snap points.
- **Layer 2 — data.** Re-derives every distance from the coordinates, every flight time from the
  documented model, and every colour and fare band from the hours, then checks the four reference
  distances and that nothing is duplicated, unsourced or unregioned.
- **Layer 3 — adversarial.** Inverted slider handles, 120 zoom clicks in each direction, 250 random
  interactions, four viewport changes, keyboard shortcuts, focus stealing, and accessibility basics —
  asserting no NaN reaches the transform and that state always recovers.

The destination table lives in one array at the top of the `<script>` block in `index.html`
(`DESTINATIONS`), so a row can be added or corrected there directly without touching any rendering
code. `data/` holds the pinned upstream inputs so the build is reproducible offline.

## Refreshing the data

Route data and fares are the parts that go stale. To re-verify:

1. Re-fetch the Wikipedia table and re-resolve IATA codes through Wikidata into `data/`.
2. Re-check anything the table added or dropped against a source independent of it — the other
   endpoint's airport article, the airline's own booking engine or network release, or AeroRoutes —
   and record the verdict and its evidence in `data/verified.json`.
3. Re-sample one fare anchor per time band and update `FARE_BANDS` in `build.py`, including the
   `sampled` date in `data/verified.json`.
4. `python3 build.py && QA_ENGINE=chromium node qa.js`, then commit `index.html` alongside the data.

Nothing here is inferred. If a route cannot be sourced it does not go on the map, and the reason it
was excluded is written down in `data/verified.json`.
