/* Three-layer QA for index.html
   L1 functional  — every control does what it claims, desktop + mobile
   L2 data        — derived values are internally consistent and match ground truth
   L3 adversarial — edge states, rapid input, resize, empty sets, keyboard, a11y
*/
const pw = require('/opt/node22/lib/node_modules/playwright');
const devices = pw.devices;
const ENGINE = process.env.QA_ENGINE || 'chromium';
const engine = pw[ENGINE];
const URL = 'file:///home/user/ruh-nonstop/index.html';
const fails = [], warns = [], notes = [];
const ok = (c, m) => { if (!c) fails.push('<' + ENGINE + '> ' + m); };
const warn = (c, m) => { if (!c) warns.push('<' + ENGINE + '> ' + m); };

async function newPage(b, opts) {
  const ctx = await b.newContext(opts);
  const pg = await ctx.newPage();
  pg.on('pageerror', e => fails.push('JS ERROR: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') fails.push('CONSOLE: ' + m.text()); });
  pg.on('request', r => { const u = r.url(); if (!u.startsWith('file:') && !u.startsWith('data:')) fails.push('NETWORK LEAK: ' + u); });
  await pg.goto(URL);
  await pg.waitForTimeout(700);
  return pg;
}

(async () => {
  const b = await engine.launch(ENGINE === 'chromium' ? { executablePath: '/opt/pw-browsers/chromium' } : {});

  /* ============================= LAYER 2: DATA ============================= */
  {
    const pg = await newPage(b, { viewport: { width: 1440, height: 900 } });
    const d = await pg.evaluate(() => {
      const D = DESTINATIONS;
      const bad = [];
      const R = 6371.0088, D2R = Math.PI / 180;
      const hav = (a, b, c, e) => { const p1 = a * D2R, p2 = c * D2R, dp = (c - a) * D2R, dl = (e - b) * D2R;
        const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
        return R * 2 * Math.asin(Math.min(1, Math.sqrt(x))); };
      for (const x of D) {
        if (!Number.isFinite(x.km) || x.km <= 0) bad.push(`${x.iata} km=${x.km}`);
        if (!Number.isFinite(x.hrs) || x.hrs <= 0) bad.push(`${x.iata} hrs=${x.hrs}`);
        if (!Number.isFinite(x.x) || !Number.isFinite(x.y)) bad.push(`${x.iata} projection NaN`);
        if (Math.abs(x.lat) > 90 || Math.abs(x.lon) > 180) bad.push(`${x.iata} coords out of range`);
        // hrs must be exactly the documented model
        const want = Math.round((0.5 + x.km / 780) * 100) / 100;
        if (Math.abs(x.hrs - want) > 0.02) bad.push(`${x.iata} hrs ${x.hrs} != model ${want}`);
        // km must be haversine of its own coords
        const wantKm = Math.round(hav(24.9576, 46.6988, x.lat, x.lon));
        if (Math.abs(x.km - wantKm) > 1) bad.push(`${x.iata} km ${x.km} != haversine ${wantKm}`);
        // band must match hours
        let wb = BANDS.length - 1;
        for (let i = 0; i < BANDS.length; i++) if (x.hrs < BANDS[i].max) { wb = i; break; }
        if (x.band !== wb) bad.push(`${x.iata} band ${x.band} != ${wb}`);
        // fare band must match hours
        let wf = FARES.bands.length - 1;
        for (let i = 0; i < FARES.bands.length; i++) if (x.hrs < FARES.bands[i].max) { wf = i; break; }
        if (x.fb !== wf) bad.push(`${x.iata} fareband ${x.fb} != ${wf}`);
        if (!x.airlines || !x.airlines.length) bad.push(`${x.iata} no airlines`);
        if (!['high', 'medium', 'low'].includes(x.conf)) bad.push(`${x.iata} conf=${x.conf}`);
        if (!PROVENANCE[x.src]) bad.push(`${x.iata} unknown provenance ${x.src}`);
        if (!x.region) bad.push(`${x.iata} no region`);
      }
      const ref = { JED: 852, DXB: 873, CAI: 1612, LHR: 4941 };
      const by = Object.fromEntries(D.map(x => [x.iata, x]));
      for (const [k, v] of Object.entries(ref)) {
        if (!by[k]) bad.push(`reference route ${k} missing`);
        else if (by[k].km !== v) bad.push(`REF ${k} ${by[k].km} != ${v}`);
      }
      const dupes = D.map(x => x.iata).filter((v, i, a) => a.indexOf(v) !== i);
      if (dupes.length) bad.push('duplicate IATA: ' + dupes);
      return { bad, n: D.length, countries: new Set(D.map(x => x.country)).size,
        noPoly: [...new Set(D.filter(x => !x.ne).map(x => x.country))],
        wd: D.filter(x => x.cs === 'WD').map(x => x.iata),
        sorted: D.every((x, i) => i === 0 || D[i - 1].hrs <= x.hrs ),
        restored: D.filter(x => x.src === 'restored').map(x => x.iata),
        dropped: ['DMK', 'LCA'].filter(c => by[c]),
        samples: [['JED', by.JED], ['CAI', by.CAI], ['LHR', by.LHR], ['JFK', by.JFK]]
          .filter(([, v]) => v).map(([k, v]) => `${k} ${v.km}km ${v.hrs}h SAR${v.fare?'':''}${v.fb}`) };
    });
    ok(d.bad.length === 0, 'L2 data integrity: ' + d.bad.slice(0, 8).join(' | '));
    ok(d.sorted, 'L2 DESTINATIONS not sorted by hours');
    ok(d.dropped.length === 0, 'L2 verified-ended routes still present: ' + d.dropped);
    notes.push(`L2 ${d.n} destinations / ${d.countries} countries; restored=${d.restored.join(',')}; wikidata-coords=${d.wd.join(',')}; no-polygon=${d.noPoly.join(', ')}`);
    await pg.context().close();
  }

  /* =========================== LAYER 1: FUNCTIONAL ========================== */
  for (const [name, opts] of [
    ['desktop', { viewport: { width: 1440, height: 900 } }],
    ['laptop',  { viewport: { width: 1180, height: 720 } }],
    ['mobile',  ENGINE === 'firefox'
        ? { viewport: devices['iPhone 13'].viewport, userAgent: devices['iPhone 13'].userAgent, hasTouch: true }
        : { ...devices['iPhone 13'] }],
    ['tablet',  ENGINE === 'firefox'
        ? { viewport: devices['iPad Mini'].viewport, userAgent: devices['iPad Mini'].userAgent, hasTouch: true }
        : { ...devices['iPad Mini'] }],
  ]) {
    const pg = await newPage(b, opts);
    const isMobile = name === 'mobile';
    // A touch context must be driven with touch: in Firefox, mouse.* emits no
    // pointer events at all once hasTouch is set, so using it would test nothing.
    const isTouch = !!opts.hasTouch;
    const tapAt = async (x, y) => {
      if (isTouch) return pg.touchscreen.tap(x, y);
      await pg.mouse.move(x, y); await pg.waitForTimeout(60);
      await pg.mouse.down(); await pg.waitForTimeout(40); await pg.mouse.up();
    };
    const P = s => `[${name}] ` + s;
    try {

    ok(await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
       P('L1 horizontal overflow'));

    // counts agree between header, tally and list
    const c1 = await pg.evaluate(() => ({ hdr: document.querySelector('#s-dest').textContent,
      tally: document.querySelector('#t-n').textContent,
      rows: document.querySelectorAll('.row').length,
      dots: [...document.querySelectorAll('#g-dots circle[data-iata], #g-dots circle')].filter(c => c.classList.contains('dot') && c.style.display !== 'none').length,
      arcs: [...document.querySelectorAll('#g-arcs path')].filter(c => c.style.display !== 'none').length }));
    ok(c1.tally === String(c1.rows) && c1.rows === c1.dots && c1.dots === c1.arcs,
       P(`L1 count mismatch ${JSON.stringify(c1)}`));

    // clicking a MAP dot opens the detail panel (the reported bug)
    const clicked = await pg.evaluate(() => {
      // only destinations inside the band the sheet is not covering are clickable
      const m = document.querySelector('#mapwrap').getBoundingClientRect();
      const sh = document.querySelector('aside').getBoundingClientRect();
      const bottom = getComputedStyle(document.querySelector('aside')).position === 'absolute'
        ? Math.min(m.bottom, sh.top) : m.bottom;
      const inBand = d => { const r = dotEls.get(d.iata).getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        return x > m.left + 8 && x < m.right - 8 && y > m.top + 8 && y < bottom - 8; };
      // pick an isolated destination so the nearest-pick answer is unambiguous
      const cand = DESTINATIONS.filter(d => visible.has(d.iata) && inBand(d));
      let target = null, bestSep = -1;
      for (const d of cand) {
        let sep = Infinity;
        for (const o of cand) if (o !== d) sep = Math.min(sep, Math.hypot(o.x - d.x, o.y - d.y));
        if (sep > bestSep) { bestSep = sep; target = d; }
      }
      const el = dotEls.get(target.iata).getBoundingClientRect();
      const offBand = DESTINATIONS.filter(d => visible.has(d.iata) && !inBand(d)).map(d => d.iata);
      return { iata: target.iata, w: Math.round(PICK_PX * 2), sep: Math.round(bestSep),
               offBand, cx: el.left + el.width / 2, cy: el.top + el.height / 2 };
    });
    ok(clicked.w >= 20, P(`L1 map tap target only ${clicked.w}px wide`));
    warn((clicked.offBand || []).length === 0, P(`L1 destinations outside the reachable map band: ${(clicked.offBand||[]).slice(0,6)}`));
    await tapAt(clicked.cx, clicked.cy);
    await pg.waitForTimeout(150);
    // wait for the slide-in transition to settle rather than guessing a duration
    await pg.waitForFunction(() => {
      const d = document.querySelector('#detail');
      if (!d.classList.contains('on')) return true;      // let the assertion report it
      const tr = getComputedStyle(d).transform;
      return tr === 'none' || tr === 'matrix(1, 0, 0, 1, 0, 0)';
    }, null, { timeout: 5000 }).catch(() => {});
    const det = await pg.evaluate(() => ({ on: document.querySelector('#detail').classList.contains('on'),
      city: (document.querySelector('#d-city')||{}).textContent||'',
      inAside: (() => { const p = document.querySelector('#detail').getBoundingClientRect(),
        a = document.querySelector('aside').getBoundingClientRect();
        return p.left >= a.left - 1 && p.right <= a.right + 1; })(),
      hasTime: /\dh\d\d/.test((document.querySelector('.big b')||{}).textContent||''),
      hasFare: /SAR/.test(document.querySelector('#d-body').textContent),
      links: document.querySelectorAll('.gf a').length,
      prov: !!document.querySelector('.prov') }));
    ok(det.on, P('L1 clicking a map dot did NOT open the detail panel'));
    ok(det.city.includes(clicked.iata), P(`L1 detail opened wrong destination: ${det.city} vs ${clicked.iata}`));
    ok(det.inAside, P('L1 detail panel escapes the sidebar'));
    ok(det.hasTime, P('L1 detail headline is not a flight time'));
    ok(det.hasFare, P('L1 detail has no fare band'));
    ok(det.links === 4, P(`L1 expected 4 dated links, got ${det.links}`));
    ok(det.prov, P('L1 detail has no provenance block'));
    await pg.evaluate(() => document.querySelector('#d-back').click()); await pg.waitForTimeout(250);

    // clicking a LIST row also opens it
    await pg.evaluate(() => document.querySelector('.row').click()); await pg.waitForTimeout(300);
    ok(await pg.evaluate(() => document.querySelector('#detail').classList.contains('on')), P('L1 list row did not open detail'));
    await pg.evaluate(() => document.querySelector('#d-back').click()); await pg.waitForTimeout(200);

    // hour filter actually filters by hours
    const filt = await pg.evaluate(() => {
      const el = document.querySelector('#dmax');
      el.value = 4; el.dispatchEvent(new Event('input', { bubbles: true }));
      const shown = DESTINATIONS.filter(d => d.hrs <= 4 && state.regions.has(d.region));
      return { label: document.querySelector('#dist-lbl').textContent,
               rows: document.querySelectorAll('.row').length, expect: shown.length,
               anyOver: [...document.querySelectorAll('.row')].map(r => r.dataset.iata)
                 .filter(i => DESTINATIONS.find(d => d.iata === i).hrs > 4) };
    });
    ok(filt.rows === filt.expect && filt.anyOver.length === 0,
       P(`L1 hour filter wrong: ${filt.rows}/${filt.expect}, over-limit=${filt.anyOver}`));
    ok(/h\d\d/.test(filt.label), P(`L1 filter label not in hours: "${filt.label}"`));

    // region chips
    await pg.evaluate(() => { document.querySelector('#t-reset').click(); });
    await pg.waitForTimeout(200);
    const chip = await pg.evaluate(() => {
      const c = document.querySelector('.chip[data-r]'); const r = c.dataset.r; c.click();
      return { region: r, pressed: c.getAttribute('aria-pressed'),
               leaked: [...document.querySelectorAll('.row')].map(x => x.dataset.iata)
                 .filter(i => DESTINATIONS.find(d => d.iata === i).region === r).length };
    });
    ok(chip.pressed === 'false' && chip.leaked === 0, P(`L1 chip ${chip.region} off but ${chip.leaked} rows remain`));

    // empty state — the toggle-all chip clears whenever anything is selected
    await pg.evaluate(() => { document.querySelector('#t-reset').click(); });
    await pg.waitForTimeout(150);
    await pg.evaluate(() => { document.querySelector('.chip.all').click(); });
    await pg.waitForTimeout(200);
    const empty = await pg.evaluate(() => ({ rows: document.querySelectorAll('.row').length,
      msg: !!document.querySelector('.empty'), hdr: document.querySelector('#s-dest').textContent,
      med: document.querySelector('#s-med').textContent }));
    ok(empty.rows === 0 && empty.msg, P('L1 no empty state when all regions off'));
    ok(!/NaN/.test(empty.med), P(`L1 empty-state median is "${empty.med}"`));
    await pg.evaluate(() => document.querySelector('#t-reset').click());
    await pg.waitForTimeout(200);

    // search
    const srch = await pg.evaluate(() => {
      const q = document.querySelector('#q'); q.value = 'colombo';
      q.dispatchEvent(new Event('input', { bubbles: true }));
      return [...document.querySelectorAll('.row')].map(r => r.dataset.iata);
    });
    ok(srch.includes('CMB'), P(`L1 search "colombo" -> ${srch}`));
    await pg.evaluate(() => { const q = document.querySelector('#q'); q.value = '';
      q.dispatchEvent(new Event('input', { bubbles: true })); });

    // collapsible country groups
    const grp = await pg.evaluate(() => {
      const h = document.querySelector('.ghead'); const g = h.closest('.grp');
      const before = g.querySelectorAll('.row').length; h.click();
      return { before, closed: g.classList.contains('closed'), exp: h.getAttribute('aria-expanded'),
               vis: getComputedStyle(g.querySelector('.rows')).display };
    });
    ok(grp.closed && grp.exp === 'false' && grp.vis === 'none', P('L1 country group does not collapse'));
    await pg.evaluate(() => document.querySelector('.ghead').click());

    // zoom: counter-scaling + pan proportionality
    const zoom = await pg.evaluate(() => {
      document.querySelector('#z-rst').click();
      const k0 = +/scale\(([\d.]+)\)/.exec(document.querySelector('#scene').getAttribute('transform'))[1];
      document.querySelector('#z-in').click(); document.querySelector('#z-in').click();
      const tr = document.querySelector('#scene').getAttribute('transform');
      const k = +/scale\(([\d.]+)\)/.exec(tr)[1];
      const dot = document.querySelector('#g-dots circle');
      return { k0, k, ratio: k / k0, dotR: +dot.getAttribute('r'), wantR: 3.1 / k,
               lbl: parseFloat(document.querySelector('.lbl').style.fontSize), wantLbl: 10 / k };
    });
    ok(Math.abs(zoom.ratio - 2.25) < 0.01, P(`L1 two zoom-ins gave ${zoom.ratio.toFixed(3)}x, expected 2.25x`));
    ok(Math.abs(zoom.dotR - zoom.wantR) < 0.01, P(`L1 dot not counter-scaled: ${zoom.dotR} vs ${zoom.wantR}`));
    ok(Math.abs(zoom.lbl - zoom.wantLbl) < 0.05, P(`L1 label not counter-scaled: ${zoom.lbl} vs ${zoom.wantLbl}`));

    if (isMobile) {
      const snaps = [];
      for (let i = 0; i < 4; i++) {
        snaps.push(await pg.evaluate(() => getComputedStyle(document.querySelector('aside')).getPropertyValue('--sheet').trim()));
        await pg.tap('#grab'); await pg.waitForTimeout(420);
      }
      ok(new Set(snaps).size >= 3, P(`L1 sheet snaps did not cycle: ${snaps}`));
    }
    } catch (e) {
      fails.push(P('L1 threw: ' + String(e.message).split('\n')[0].slice(0, 160)));
    }
    await pg.context().close();
  }

  /* ========================== LAYER 3: ADVERSARIAL ========================= */
  {
    const pg = await newPage(b, { viewport: { width: 1440, height: 900 } });
    try {

    // inverted slider handles must not produce a negative window
    const inv = await pg.evaluate(() => {
      const lo = document.querySelector('#dmin'), hi = document.querySelector('#dmax');
      hi.value = 2; hi.dispatchEvent(new Event('input', { bubbles: true }));
      lo.value = 10; lo.dispatchEvent(new Event('input', { bubbles: true }));
      return { min: state.min, max: state.max, rows: document.querySelectorAll('.row').length,
               lbl: document.querySelector('#dist-lbl').textContent };
    });
    ok(inv.min <= inv.max, `L3 slider inverted: min=${inv.min} max=${inv.max}`);
    ok(!/NaN|Infinity|undefined/.test(inv.lbl), `L3 slider label "${inv.lbl}"`);
    await pg.evaluate(() => document.querySelector('#t-reset').click());

    // zoom clamps
    const clamp = await pg.evaluate(() => {
      for (let i = 0; i < 40; i++) document.querySelector('#z-in').click();
      const kMax = view.k;
      for (let i = 0; i < 80; i++) document.querySelector('#z-out').click();
      const kMin = view.k;
      const t = document.querySelector('#scene').getAttribute('transform');
      return { kMax, kMin, nan: /NaN/.test(t) };
    });
    ok(!clamp.nan, 'L3 transform contains NaN after extreme zooming');
    ok(clamp.kMax <= 42.001 && clamp.kMin >= 0.999, `L3 zoom not clamped: ${clamp.kMin}..${clamp.kMax}`);

    // rapid random interaction — should never throw or desync
    await pg.evaluate(() => {
      const acts = [() => document.querySelector('#z-in').click(), () => document.querySelector('#z-out').click(),
        () => document.querySelector('#z-rst').click(),
        () => { const c = document.querySelectorAll('.chip[data-r]'); c[Math.floor(Math.random() * c.length)].click(); },
        () => { const s = document.querySelector('#dmax'); s.value = Math.random() * 16; s.dispatchEvent(new Event('input', { bubbles: true })); },
        () => { const r = document.querySelectorAll('.row'); if (r.length) r[Math.floor(Math.random() * r.length)].click(); },
        () => { const d = document.querySelector('#d-back'); if (d) d.click(); }];
      for (let i = 0; i < 250; i++) acts[Math.floor(Math.random() * acts.length)]();
    });
    await pg.waitForTimeout(300);
    await pg.evaluate(() => document.querySelector('#t-reset').click());
    await pg.waitForTimeout(200);
    const after = await pg.evaluate(() => ({ rows: document.querySelectorAll('.row').length,
      hdr: +document.querySelector('#s-dest').textContent, total: DESTINATIONS.length,
      nan: /NaN/.test(document.querySelector('#scene').getAttribute('transform')) }));
    ok(!after.nan, 'L3 NaN in transform after fuzzing');
    ok(after.rows === after.total && after.hdr === after.total,
       `L3 reset after fuzzing did not restore all rows: ${after.rows}/${after.total}`);

    await pg.evaluate(() => { const d = document.querySelector('#d-back'); if (d) d.click(); });
    // resize must not break the fit
    for (const [w, h] of [[600, 900], [1920, 1080], [360, 640], [1440, 900]]) {
      await pg.setViewportSize({ width: w, height: h });
      await pg.waitForTimeout(350);
      const r = await pg.evaluate(() => ({ t: document.querySelector('#scene').getAttribute('transform'),
        over: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
      ok(!/NaN/.test(r.t), `L3 NaN transform at ${w}x${h}`);
      ok(!r.over, `L3 horizontal overflow at ${w}x${h}`);
    }

    // keyboard
    await pg.setViewportSize({ width: 1440, height: 900 });
    await pg.waitForTimeout(200);
    const kb = await pg.evaluate(() => { document.querySelector('#z-rst').click(); return view.k; });
    await pg.keyboard.press('Equal'); await pg.waitForTimeout(120);
    const kbIn = await pg.evaluate(() => view.k);
    await pg.keyboard.press('Digit0'); await pg.waitForTimeout(120);
    const kbRst = await pg.evaluate(() => view.k);
    ok(kbIn > kb, 'L3 "+" key did not zoom in');
    ok(Math.abs(kbRst - kb) < 1e-6, 'L3 "0" key did not reset the view');

    // typing in search must not be hijacked by the zoom keys
    await pg.evaluate(() => { const d = document.querySelector('#d-back'); if (d) d.click(); });
    await pg.waitForTimeout(250);
    await pg.evaluate(() => document.querySelector('#q').focus()); await pg.keyboard.type('0+-');
    ok(await pg.evaluate(() => document.querySelector('#q').value === '0+-'), 'L3 zoom keys hijack typing in search');
    await pg.evaluate(() => { const q = document.querySelector('#q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); });

    // escape closes the dialog even when focus sits in a text field
    await pg.evaluate(() => { document.querySelector('#q').focus();
      document.querySelector('#about-btn').click(); });
    await pg.waitForTimeout(250);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(250);
    ok(!await pg.evaluate(() => document.querySelector('#about').classList.contains('on')),
       'L3 Escape did not close About (focus in search field)');
    // and focus is handed back, not dropped on <body>
    await pg.evaluate(() => { const b = document.querySelector('#about-btn'); b.focus(); b.click(); });
    await pg.waitForTimeout(250);
    const focusIn = await pg.evaluate(() => document.activeElement.id);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    const focusBack = await pg.evaluate(() => document.activeElement.id);
    ok(focusIn === 'about-x', `L3 opening About did not move focus into it (got "${focusIn}")`);
    ok(focusBack === 'about-btn', `L3 closing About did not restore focus (got "${focusBack}")`);

    // a11y basics
    const a11y = await pg.evaluate(() => {
      const noLabel = [...document.querySelectorAll('button')]
        .filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title)
        .map(b => b.className || b.id);
      return { noLabel, lang: document.documentElement.lang,
        title: document.title, h1: document.querySelectorAll('h1').length,
        pressed: document.querySelectorAll('.chip[aria-pressed]').length,
        expanded: document.querySelectorAll('.ghead[aria-expanded]').length };
    });
    warn(a11y.noLabel.length === 0, 'L3 buttons without accessible names: ' + a11y.noLabel);
    ok(a11y.lang === 'en' && a11y.h1 === 1 && !!a11y.title, 'L3 document metadata incomplete');
    ok(a11y.pressed > 0 && a11y.expanded > 0, 'L3 chips/groups missing aria state');

    // ship-readiness: things that only matter once strangers are hitting it
    const ship = await pg.evaluate(() => {
      const meta = n => (document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)||{}).content||'';
      const css = [...document.styleSheets[0].cssRules].map(r => r.cssText).join('\n');
      return { noscript: !!document.querySelector('noscript'),
        icon: !!document.querySelector('link[rel=icon]'),
        ogTitle: meta('og:title'), ogImage: meta('og:image'), themeColor: meta('theme-color'),
        desc: meta('description'),
        reducedMotion: /prefers-reduced-motion/.test(css),
        staleEl: !!document.querySelector('#stale'),
        ageDays: META.ageDays, built: META.built,
        lang: document.documentElement.lang };
    });
    ok(ship.noscript, 'L3 no <noscript> fallback');
    ok(ship.icon, 'L3 no favicon');
    ok(ship.ogTitle && ship.ogImage && ship.desc, 'L3 incomplete social/meta tags');
    ok(!!ship.themeColor, 'L3 no theme-color');
    // Asserted against the source, not the CSSOM: a browser that supports dvh
    // discards the preceding vh fallback, so it is invisible from inside the page.
    const src = require('fs').readFileSync('/home/user/ruh-nonstop/index.html', 'utf8');
    const dvhUses = (src.match(/[\d.]+dvh/g) || []).length;
    const dvhFallbacks = (src.match(/(\d+)vh;\s*(?:max-)?height:\s*\1dvh/g) || []).length;
    ok(dvhUses > 0 && dvhFallbacks === dvhUses,
       `L3 ${dvhUses} dvh uses but only ${dvhFallbacks} have a vh fallback (breaks Safari < 15.4)`);
    ok(ship.reducedMotion, 'L3 no prefers-reduced-motion handling');
    ok(ship.staleEl && typeof ship.ageDays === 'number', 'L3 no staleness surface');
    notes.push(`L3 built ${ship.built}, data age ${ship.ageDays}d; meta+noscript+favicon+reduced-motion present`);

    // a thrown boot must not take the list down with it
    const resilient = await pg.evaluate(() => {
      const g = document.querySelector('#g-arcs');
      return !!(g && document.querySelectorAll('.row').length);
    });
    ok(resilient, 'L3 page did not render list + map together');

    // About panel must document both estimates
    await pg.evaluate(() => document.querySelector('#about-btn').click()); await pg.waitForTimeout(200);
    const about = await pg.evaluate(() => document.querySelector('#about').textContent);
    ok(/0\.5 \+ km \/ 780/.test(about), 'L3 About does not show the flight-time formula');
    ok(/2026-07-31/.test(about), 'L3 About does not show the fare sample date');
    ok(/not quotes for a route|not quotes|order of magnitude/i.test(about), 'L3 About does not caveat the fares');
    } catch (e) {
      fails.push('L3 threw: ' + String(e.message).split('\n')[0].slice(0, 160));
    }
    await pg.context().close();
  }

  await b.close();
  console.log(`\n=== QA RESULT (${ENGINE}) ===`);
  notes.forEach(n => console.log('  ' + n));
  if (warns.length) { console.log('\nWARN:'); warns.forEach(w => console.log('  ! ' + w)); }
  if (fails.length) { console.log(`\nFAIL (${fails.length}):`); fails.forEach(f => console.log('  x ' + f)); process.exitCode = 1; }
  else console.log('\nAll three layers passed.');
})();
