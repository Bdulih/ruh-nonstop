/* UI/UX audit — the things a screenshot shows but a functional test does not:
   fonts that fell back, text that collides or overflows, contrast, tap targets.
   Run: QA_ENGINE=chromium node uiux.js   (also firefox, webkit)              */
const pw = (() => { for (const p of ['playwright','/opt/node22/lib/node_modules/playwright'])
  { try { return require(p); } catch (e) {} } process.exit(2); })();
const ENGINE = process.env.QA_ENGINE || 'chromium';
const path = require('path'), fs = require('fs');
const URL = 'file://' + path.join(__dirname, 'index.html');
const bad = [], warn = [], note = [];
const F = (c, m) => { if (!c) bad.push(`<${ENGINE}> ${m}`); };
const W = (c, m) => { if (!c) warn.push(`<${ENGINE}> ${m}`); };

const VIEWS = [
  ['phone',   { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3 }],
  ['phone-sm',{ viewport: { width: 320, height: 568 }, hasTouch: true }],
  ['tablet',  { viewport: { width: 768, height: 1024 }, hasTouch: true }],
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['wide',    { viewport: { width: 1920, height: 1080 } }],
];

(async () => {
  const b = await pw[ENGINE].launch(
    ENGINE === 'chromium' && fs.existsSync('/opt/pw-browsers/chromium')
      ? { executablePath: '/opt/pw-browsers/chromium' } : {});

  for (const [name, opts] of VIEWS) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await b.newContext({ ...opts, colorScheme: scheme });
      const pg = await ctx.newPage();
      await pg.goto(URL); await pg.waitForTimeout(700);
      const P = s => `[${name}/${scheme}] ${s}`;

      /* ---- 1. fonts actually resolved, not silently fallen back ---------- */
      const font = await pg.evaluate(() => {
        const cs = getComputedStyle(document.body);
        // does the first family in the stack actually render?
        const probe = (fam) => {
          const c = document.createElement('canvas').getContext('2d');
          c.font = '72px monospace'; const base = c.measureText('WWWiii').width;
          c.font = `72px ${fam}, monospace`;
          return c.measureText('WWWiii').width !== base;
        };
        return { stack: cs.fontFamily, size: cs.fontSize,
                 systemUI: probe('-apple-system') || probe('system-ui') || probe('BlinkMacSystemFont'),
                 helveticaOnly: /Helvetica/i.test(cs.fontFamily.split(',')[0]) };
      });
      F(!font.helveticaOnly, P('body font resolves to Helvetica first'));
      F(parseFloat(font.size) >= 15, P(`body font-size ${font.size} is under 15px`));
      if (name === 'phone' && scheme === 'light')
        note.push(`font stack: ${font.stack.split(',').slice(0,2).join(',')} @ ${font.size}`);

      /* ---- 2. no overlapping map labels ---------------------------------- */
      await pg.evaluate(() => { for (let i = 0; i < 3; i++) document.querySelector('#z-in').click(); });
      await pg.waitForTimeout(400);
      const collide = await pg.evaluate(() => {
        const ls = [...document.querySelectorAll('.lbl')]
          .filter(e => e.style.display !== 'none')
          .map(e => ({ t: e.textContent, r: e.getBoundingClientRect() }))
          .filter(x => x.r.width);
        const hits = [];
        for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
          const a = ls[i].r, c = ls[j].r;
          if (!(a.right < c.left || a.left > c.right || a.bottom < c.top || a.top > c.bottom))
            hits.push(`${ls[i].t}|${ls[j].t}`);
        }
        return { n: ls.length, hits };
      });
      F(collide.hits.length === 0, P(`${collide.hits.length} overlapping map labels: ${collide.hits.slice(0,3)}`));
      await pg.evaluate(() => document.querySelector('#z-rst').click());
      await pg.waitForTimeout(250);

      /* ---- 3. nothing overflows its container ---------------------------- */
      const overflow = await pg.evaluate(() => {
        const out = [];
        for (const e of document.querySelectorAll('aside *, header *')) {
          if (!e.offsetParent && e.tagName !== 'BODY') continue;
          if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible'
              && e.clientWidth > 0)
            out.push((e.className || e.tagName) + ` ${e.scrollWidth}>${e.clientWidth}`);
        }
        return out.slice(0, 5);
      });
      W(overflow.length === 0, P(`content overflows: ${overflow}`));

      /* ---- 4. tap targets on touch --------------------------------------- */
      if (opts.hasTouch) {
        const small = await pg.evaluate(() => [...document.querySelectorAll('button, a, input')]
          .filter(e => e.offsetParent)
          .map(e => { const r = e.getBoundingClientRect();
                      return { id: e.id || e.className || e.tagName, h: Math.round(r.height), w: Math.round(r.width) }; })
          .filter(x => x.h > 0 && (x.h < 32 || x.w < 32)).slice(0, 6));
        W(small.length === 0, P(`tap targets under 32px: ${JSON.stringify(small)}`));
      }

      /* ---- 5. text contrast against its own background -------------------- */
      const contrast = await pg.evaluate(() => {
        const lum = c => { const [r,g,b] = c.match(/\d+/g).map(Number).map(v => {
          v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
          return 0.2126*r + 0.7152*g + 0.0722*b; };
        const bgOf = e => { let n = e; while (n && n !== document.documentElement) {
          const c = getComputedStyle(n).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; n = n.parentElement; }
          return 'rgb(255,255,255)'; };
        const out = [];
        for (const e of document.querySelectorAll('aside p, aside span, aside b, aside dd, aside dt, header *, .row .nm, .row .km, .tally, .flabel span')) {
          if (!e.offsetParent || !e.textContent.trim()) continue;
          const cs = getComputedStyle(e);
          const fg = lum(cs.color), bg = lum(bgOf(e));
          const ratio = (Math.max(fg,bg) + 0.05) / (Math.min(fg,bg) + 0.05);
          const px = parseFloat(cs.fontSize);
          const large = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5))
            out.push(`${(e.className||e.tagName)} ${px}px ${ratio.toFixed(2)}:1`);
        }
        return [...new Set(out)].slice(0, 6);
      });
      W(contrast.length === 0, P(`text under WCAG AA: ${contrast}`));

      /* ---- 5b. the map has to be legible at real pixel sizes -------------- */
      const mapPx = await pg.evaluate(() => {
        const dot = document.querySelector('#g-dots circle.dot');
        const lbl = [...document.querySelectorAll('.lbl')].find(e => e.style.display !== 'none');
        const rs = RENDER_SCALE || 1;
        return { dotDia: dot.getBoundingClientRect().width,
                 // style font-size is in user units; convert to CSS px
                 lblPx: lbl ? parseFloat(lbl.style.fontSize) * view.k * rs : null };
      });
      F(mapPx.dotDia >= 6, P(`map dots render at ${mapPx.dotDia.toFixed(1)}px across, under 6px`));
      F(mapPx.lblPx === null || mapPx.lblPx >= 10,
        P(`map labels render at ${(mapPx.lblPx||0).toFixed(1)}px, under 10px`));

      /* ---- 5c. the sheet opens on results, not on a wall of filters ------- */
      if (opts.viewport.width <= 880) {
        const sheet = await pg.evaluate(() => {
          const l = document.querySelector('.list').getBoundingClientRect();
          return { filtersOpen: getComputedStyle(document.querySelector('.filters')).display !== 'none',
                   toggle: !!document.querySelector('#f-toggle'),
                   rowsVisible: [...document.querySelectorAll('.row')].filter(r => {
                     const b = r.getBoundingClientRect();
                     return b.top >= l.top - 1 && b.bottom <= l.bottom + 1; }).length,
                   tallyClipped: (() => { const d = document.querySelector('.tally > div');
                     return d.scrollWidth > d.clientWidth + 1; })() };
        });
        F(!sheet.filtersOpen, P('filters are expanded by default and eat the sheet'));
        F(sheet.toggle, P('no Filters control on mobile'));
        F(sheet.rowsVisible >= 3, P(`only ${sheet.rowsVisible} result rows visible in the sheet`));
        F(!sheet.tallyClipped, P('summary bar text is truncated'));
      }

      /* ---- 6. the detail panel, which is where the density is ------------- */
      await pg.evaluate(() => openDetail(DESTINATIONS.find(d => d.fpw) ? DESTINATIONS.find(d => d.fpw).iata : DESTINATIONS[0].iata));
      await pg.waitForTimeout(350);
      const detail = await pg.evaluate(() => {
        const body = document.querySelector('#d-body');
        const clipped = [...body.querySelectorAll('*')].filter(e =>
          e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0).map(e => e.className || e.tagName);
        const kv = document.querySelector('.kv');
        return { clipped: clipped.slice(0,4),
                 kvCols: kv ? getComputedStyle(kv).gridTemplateColumns : '',
                 headingPx: parseFloat(getComputedStyle(document.querySelector('.big b')).fontSize),
                 scrollable: body.scrollHeight > body.clientHeight };
      });
      F(detail.clipped.length === 0, P(`detail panel clips content: ${detail.clipped}`));
      await pg.evaluate(() => document.querySelector('#d-back').click());

      await ctx.close();
    }
  }
  await b.close();
  console.log(`\n=== UI/UX AUDIT (${ENGINE}) ===`);
  note.forEach(n => console.log('  ' + n));
  if (warn.length) { console.log('\nWARN:'); [...new Set(warn)].forEach(w => console.log('  ! ' + w)); }
  if (bad.length) { console.log(`\nFAIL (${bad.length}):`); [...new Set(bad)].forEach(f => console.log('  x ' + f)); process.exitCode = 1; }
  else console.log('\nNo UI/UX failures.');
})();
