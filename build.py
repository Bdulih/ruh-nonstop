#!/usr/bin/env python3
"""Build index.html for the RUH nonstop destination map.

Inputs (all fetched once, cached in this directory):
  airports.dat          OpenFlights   -> airport coordinates
  countries-110m.json   world-atlas   -> country boundaries (TopoJSON)
  rows3_current.json    Wikipedia KKIA passenger table, live revision
  rows3_jan2026.json    Wikipedia KKIA passenger table, 2026-01-11 revision
  title2iata.json       Wikidata      -> article title -> IATA + coords
  restored.json         research pass -> routes deleted from Wikipedia but re-verified

Output: index.html
"""
import csv, json, math, re, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = os.path.join(HERE, 'data')
p = lambda *a: os.path.join(SCRATCH, *a)

R_KM = 6371.0088
RUH = (24.9576, 46.6988)

def haversine(a, b):
    la1, lo1 = map(math.radians, a); la2, lo2 = map(math.radians, b)
    h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return R_KM*2*math.asin(min(1.0, math.sqrt(h)))

# ---------------------------------------------------------------- reference data
airports = {}
for r in csv.reader(open(p('airports.dat'), encoding='utf-8')):
    if len(r) > 7 and len(r[4]) == 3 and r[4].isalpha():
        airports[r[4]] = dict(name=r[1], city=r[2], country=r[3],
                              lat=float(r[6]), lon=float(r[7]))

t2i = json.load(open(p('title2iata.json')))
ne_names = {g['properties']['name']
            for g in json.load(open(p('countries-110m.json')))['objects']['countries']['geometries']}

# OpenFlights / Wikidata country strings -> Natural Earth 1:110m names.
# Anything mapping to None genuinely has no polygon at this resolution (islands,
# city-states) and is drawn as a dot only.
NE_FIX = {
    'Czech Republic': 'Czechia',
    'Bosnia and Herzegovina': 'Bosnia and Herz.',
    'United States': 'United States of America',
    'Bahrain': None, 'Hong Kong': None, 'Singapore': None,
    'Maldives': None, 'Mauritius': None,
}

REGION_OF_COUNTRY = {
    'Saudi Arabia': 'Domestic',
    # Middle East (Gulf, Levant, Iraq, Yemen, Turkey, Cyprus)
    'United Arab Emirates': 'Middle East', 'Qatar': 'Middle East', 'Bahrain': 'Middle East',
    'Kuwait': 'Middle East', 'Oman': 'Middle East', 'Jordan': 'Middle East',
    'Lebanon': 'Middle East', 'Syria': 'Middle East', 'Iraq': 'Middle East',
    'Yemen': 'Middle East', 'Turkey': 'Middle East', 'Cyprus': 'Middle East',
    # Africa
    'Egypt': 'Africa', 'Morocco': 'Africa', 'Ethiopia': 'Africa', 'Kenya': 'Africa',
    'Uganda': 'Africa', 'Sudan': 'Africa', 'Mauritius': 'Africa', 'Tunisia': 'Africa',
    'Algeria': 'Africa', 'Djibouti': 'Africa', 'Somalia': 'Africa', 'Nigeria': 'Africa',
    'South Africa': 'Africa', 'Tanzania': 'Africa',
    # Europe
    'Italy': 'Europe', 'Spain': 'Europe', 'France': 'Europe', 'Germany': 'Europe',
    'Greece': 'Europe', 'Poland': 'Europe', 'Switzerland': 'Europe',
    'United Kingdom': 'Europe', 'Austria': 'Europe', 'Bosnia and Herzegovina': 'Europe',
    'Czech Republic': 'Europe', 'Netherlands': 'Europe', 'Russia': 'Europe',
    'Albania': 'Europe', 'Montenegro': 'Europe', 'Serbia': 'Europe', 'Portugal': 'Europe',
    'Belgium': 'Europe', 'Ireland': 'Europe', 'Sweden': 'Europe', 'Denmark': 'Europe',
    'Hungary': 'Europe', 'Romania': 'Europe', 'Bulgaria': 'Europe', 'Croatia': 'Europe',
    'Ukraine': 'Europe', 'Malta': 'Europe',
    # Caucasus & Central Asia
    'Azerbaijan': 'Caucasus & C. Asia', 'Uzbekistan': 'Caucasus & C. Asia',
    'Georgia': 'Caucasus & C. Asia', 'Armenia': 'Caucasus & C. Asia',
    'Kazakhstan': 'Caucasus & C. Asia', 'Tajikistan': 'Caucasus & C. Asia',
    'Turkmenistan': 'Caucasus & C. Asia', 'Kyrgyzstan': 'Caucasus & C. Asia',
    # South Asia
    'India': 'South Asia', 'Pakistan': 'South Asia', 'Bangladesh': 'South Asia',
    'Sri Lanka': 'South Asia', 'Nepal': 'South Asia', 'Maldives': 'South Asia',
    'Afghanistan': 'South Asia',
    # East & Southeast Asia
    'China': 'E. & SE. Asia', 'Hong Kong': 'E. & SE. Asia', 'Japan': 'E. & SE. Asia',
    'Thailand': 'E. & SE. Asia', 'Malaysia': 'E. & SE. Asia', 'Singapore': 'E. & SE. Asia',
    'Indonesia': 'E. & SE. Asia', 'Philippines': 'E. & SE. Asia',
    'South Korea': 'E. & SE. Asia', 'Vietnam': 'E. & SE. Asia',
    # Americas
    'United States': 'Americas', 'Canada': 'Americas', 'Brazil': 'Americas',
}

# City names OpenFlights leaves blank or unhelpfully abbreviated.
CITY_FIX = {
    'DWD': 'Dawadmi', 'NUM': 'Neom Bay', 'RSI': 'Red Sea', 'SPX': 'Giza',
    'RZV': 'Rize', 'UPG': 'Makassar', 'MRU': 'Port Louis', 'JTR': 'Santorini',
    'EJH': 'Al Wajh', 'MLE': 'Malé', 'HBE': 'Alexandria', 'ELQ': 'Qassim',
    'AQI': 'Qaisumah', 'WAE': 'Wadi al-Dawasir', 'EAM': 'Najran', 'ULH': 'AlUla',
    'ABT': 'Al Baha', 'AJF': 'Al Jawf', 'URY': 'Gurayat', 'TUI': 'Turaif',
    'SHW': 'Sharurah', 'RAH': 'Rafha', 'RAE': 'Arar', 'HAS': "Ha'il",
    'GIZ': 'Jizan', 'TIF': "Ta'if", 'BHH': 'Bisha', 'YNB': 'Yanbu',
    'CGK': 'Jakarta', 'DMK': 'Bangkok', 'BKK': 'Bangkok', 'PKX': 'Beijing',
    'PEK': 'Beijing', 'SAW': 'Istanbul', 'IST': 'Istanbul', 'DWC': 'Dubai',
    'DXB': 'Dubai', 'JFK': 'New York', 'IAD': 'Washington', 'SVO': 'Moscow',
    'VKO': 'Moscow', 'BGY': 'Milan', 'MXP': 'Milan', 'HMB': 'Sohag',
    'DBB': 'El Alamein', 'ATZ': 'Asyut', 'PZU': 'Port Sudan', 'BJV': 'Bodrum',
    'AER': 'Sochi', 'GYD': 'Baku', 'TAS': 'Tashkent', 'CCJ': 'Kozhikode',
    'TRV': 'Thiruvananthapuram', 'COK': 'Kochi', 'BLR': 'Bengaluru',
    'BOM': 'Mumbai', 'MED': 'Medina', 'NRT': 'Tokyo', 'HKT': 'Phuket',
}

AIRPORT_NAME_FIX = {
    'NUM': 'NEOM Bay Airport', 'RSI': 'Red Sea International Airport',
    'SPX': 'Sphinx International Airport', 'RZV': 'Rize–Artvin Airport',
}

def airport_info(iata, wd):
    """Coordinates and naming for one IATA code. `wd` is the resolved Wikidata
    record for the destination's article. OpenFlights first (it is what the
    reference distances were computed against); Wikidata P625 only where
    OpenFlights has no row at all. Never guessed."""
    if iata in airports:
        a = airports[iata]
        city = CITY_FIX.get(iata) or a['city'] or a['name'].replace(' Airport', '')
        return dict(city=city, airport=AIRPORT_NAME_FIX.get(iata, a['name']),
                    country=a['country'], lat=a['lat'], lon=a['lon'], cs='OF')
    coord = (wd or {}).get('coord')
    if not coord:
        raise SystemExit(f'no coordinates for {iata} — refusing to guess')
    country = {'NUM': 'Saudi Arabia', 'RSI': 'Saudi Arabia',
               'SPX': 'Egypt', 'RZV': 'Turkey'}.get(iata)
    if not country:
        raise SystemExit(f'no country for {iata} — refusing to guess')
    return dict(city=CITY_FIX.get(iata, wd.get('label') or iata),
                airport=AIRPORT_NAME_FIX.get(iata, wd.get('label') or iata),
                country=country, lat=coord[0], lon=coord[1], cs='WD')

# ---------------------------------------------------------------- assemble rows
def collect(rows_file):
    """iata -> {airlines, seasonal, sourced, cn, starts, wiki}"""
    out = {}
    for row in json.load(open(rows_file)):
        for d in row['dests']:
            meta = t2i[d['article']]
            i = meta['iata']
            e = out.setdefault(i, dict(airlines=[], seasonal=True, sourced=False,
                                       cn=False, starts=None, wiki=meta['canon'], wd=meta))
            if row['airline'] not in e['airlines']:
                e['airlines'].append(row['airline'])
            if not d['seasonal']:
                e['seasonal'] = False
            e['sourced'] |= d['sourced']
            e['cn'] |= d['cn']
            m = re.search(r'(?:begins|resumes)\s+(.+)', d.get('note') or '')
            if m:
                e['starts'] = normalise_date(m.group(1))
    return out

MONTHS = {m: n for n, m in enumerate(
    ['january','february','march','april','may','june','july','august',
     'september','october','november','december'], 1)}

def normalise_date(s):
    s = s.strip()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s):
        return s
    m = re.match(r'(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})', s)
    if m and m.group(2).lower() in MONTHS:
        return f'{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}'
    return None

cur = collect(p('rows3_current.json'))
old = collect(p('rows3_jan2026.json'))

restored = {}
if os.path.exists(p('restored.json')):
    restored = json.load(open(p('restored.json')))

PROVENANCE = {
    'wp-cited': dict(
        label='Wikipedia, with an independent citation',
        detail=('Listed in the live "King Khalid International Airport" airline/destination table '
                'with an inline citation to an independent source — mostly the OAG Flight Guide '
                'Worldwide (May 2025) or an airline press release.')),
    'wp-uncited': dict(
        label='Wikipedia, citation needed',
        detail=('Listed in the live Wikipedia table but tagged {{citation needed}}. Editors are '
                'actively purging uncited rows from that page, so this may disappear without the '
                'route changing — or it may be wrong. Treated as unconfirmed.')),
    'restored': dict(
        label='Deleted from Wikipedia, independently re-verified',
        detail=('Present in the 11 January 2026 revision of the Wikipedia table, deleted since '
                'during the uncited-row purge, and then re-confirmed against an independent '
                'source during a verification pass for this map.')),
}

DESTS = []
for iata, e in sorted(cur.items()):
    info = airport_info(iata, e['wd'])
    src = 'wp-cited' if e['sourced'] else 'wp-uncited'
    conf = 'high' if e['sourced'] else 'medium'
    DESTS.append(dict(iata=iata, **info, e=e, src=src, conf=conf))

for iata, r in sorted(restored.items()):
    if iata in cur:
        continue
    e = old.get(iata)
    if not e:
        continue
    info = airport_info(iata, e['wd'])
    DESTS.append(dict(iata=iata, **info, e=e, src='restored', conf=r.get('conf', 'medium')))

records = []
for d in DESTS:
    country = d['country']
    ne = NE_FIX[country] if country in NE_FIX else (country if country in ne_names else None)
    if country not in NE_FIX and ne is None:
        raise SystemExit(f'country {country!r} has no Natural Earth match and no explicit '
                         f'override — add it to NE_FIX')
    region = REGION_OF_COUNTRY.get(country)
    if not region:
        raise SystemExit(f'no region for {country!r} — add it to REGION_OF_COUNTRY')
    records.append(dict(
        iata=d['iata'], city=d['city'], airport=d['airport'], country=country, ne=ne,
        lat=round(d['lat'], 6), lon=round(d['lon'], 6), region=region,
        airlines=d['e']['airlines'], seasonal=d['e']['seasonal'],
        starts=d['e']['starts'], src=d['src'], conf=d['conf'], cs=d['cs'],
        wiki=d['e']['wiki']))

records.sort(key=lambda r: haversine(RUH, (r['lat'], r['lon'])))

# ------------------------------------------------------------------ sanity check
CHECKS = {'JED': 852, 'DXB': 873, 'CAI': 1612, 'LHR': 4941}
by = {r['iata']: r for r in records}
for iata, want in CHECKS.items():
    if iata not in by:
        raise SystemExit(f'sanity check {iata} missing from output')
    got = round(haversine(RUH, (by[iata]['lat'], by[iata]['lon'])))
    if got != want:
        raise SystemExit(f'SANITY CHECK FAILED RUH-{iata}: got {got} want {want}')
print('sanity checks pass:', ' | '.join(f'RUH-{k} {v} km' for k, v in CHECKS.items()))

BANDS = [
    dict(max=1000,   label='<1,000 km'),
    dict(max=2500,   label='1–2.5k'),
    dict(max=5000,   label='2.5–5k'),
    dict(max=8000,   label='5–8k'),
    dict(max=10**9,  label='8k+'),
]

built = datetime.date.today().isoformat()
META = dict(note=(
    f'Route table built {built} from the English Wikipedia "King Khalid International Airport" '
    f'article (live revision plus the 11 January 2026 revision for routes since deleted), '
    f'with destinations resolved to IATA codes through Wikidata and coordinates from OpenFlights. '
    f'{len(records)} destinations. No flight times, frequencies or fares are stored anywhere in '
    f'this file — by design.'))

def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))

tpl = open(p('template.html'), encoding='utf-8').read()
topo = open(p('countries-110m.json'), encoding='utf-8').read()
topo = dumps(json.loads(topo))

html = (tpl.replace('__TOPO__', topo)
           .replace('__PROVENANCE__', json.dumps(PROVENANCE, ensure_ascii=False, indent=1))
           .replace('__DATA__', '[\n' + ',\n'.join('  ' + dumps(r) for r in records) + '\n]')
           .replace('__META__', dumps(META))
           .replace('__BANDS__', dumps(BANDS)))

out = os.path.join(HERE, 'index.html')
open(out, 'w', encoding='utf-8').write(html)
print(f'wrote {out}  {len(html)/1024:.0f} KB  {len(records)} destinations '
      f'{len({r["country"] for r in records})} countries')
from collections import Counter
print('provenance:', dict(Counter(r['src'] for r in records)))
print('regions:', dict(Counter(r['region'] for r in records)))
print('coord source:', dict(Counter(r['cs'] for r in records)))
print('no polygon:', sorted({r['country'] for r in records if not r['ne']}))
