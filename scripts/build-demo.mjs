#!/usr/bin/env node
// Phase 2 capstone / offline proof.
// Builds a self-contained HTML page for ONE set using ONLY local data:
//   - card/variant/tier/price rows from the local pokedex Postgres
//   - card art read from the local WebP cache, inlined as data: URIs
// If this renders, nothing but the local DB + image cache produced it — which
// is exactly the offline-resilience claim. No network is touched at build time.
//
// Usage: node scripts/build-demo.mjs <tcgdex_set_id> <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const setId = process.argv[2] || 'base1';
const out = process.argv[3] || '/tmp/pokedex-demo.html';
const CACHE = process.env.IMAGE_CACHE_ROOT || `${process.env.HOME}/pokedex/cache`;

const q = (sql) =>
  execFileSync('sudo', ['-n', '-u', 'postgres', 'psql', '-d', 'pokedex', '-tAF\t', '-c', sql], {
    encoding: 'utf8', maxBuffer: 1 << 28,
  }).trim();

// Set header
const [setName, seriesName, releaseDate, printed, total] = q(
  `select s.name, se.name, to_char(s.released_on,'Mon YYYY'),
          coalesce(s.card_count_official,0), count(c.id)
   from card_set s join series se on se.id=s.series_id
   join card c on c.set_id=s.id
   where s.tcgdex_id='${setId}' group by 1,2,3,4`
).split('\t');

// Progress (default user) — complete goal
const prog = q(
  `select goal, owned_required, total_required, set_level
   from user_set_progress usp join card_set s on s.id=usp.set_id
   where s.tcgdex_id='${setId}' order by case goal when 'complete' then 1 when 'master' then 2 else 3 end`
).split('\n').filter(Boolean).map((r) => r.split('\t'));

// Cards: primary variant, resolved tier, best USD price, variant count, local art
const rows = q(
  `select c.local_id, c.name, c.local_id_numeric,
          pv.display_name,
          (select count(*) from card_variant x where x.card_id=c.id) as vcount,
          (select r.tier from variant_tier_resolved r where r.card_variant_id=pv.id) as tier,
          (select pc.market_minor from price_current pc where pc.card_variant_id=pv.id and pc.currency_code='USD' order by pc.market_minor desc nulls last limit 1) as usd,
          (select ia.relative_path from image_asset ia
             where ia.relative_path like '%/${setId}/'||c.local_id||'.low.webp' limit 1) as relative_path
   from card c
   join card_set s on s.id=c.set_id
   join lateral (select cv.* from card_variant cv where cv.card_id=c.id order by cv.is_primary desc, cv.sort_order asc limit 1) pv on true
   where s.tcgdex_id='${setId}'
   order by c.local_id_numeric nulls last, c.local_id`
).split('\n').filter(Boolean).map((r) => r.split('\t'));

const dataUri = (rel) => {
  if (!rel || rel === '') return null;
  try {
    const b = readFileSync(`${CACHE}/${rel}`);
    return `data:image/webp;base64,${b.toString('base64')}`;
  } catch { return null; }
};

const money = (minor) => (minor && minor !== '') ? `$${(Number(minor) / 100).toFixed(2)}` : '—';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let cached = 0, priced = 0;
const tiles = rows.map(([lid, name, , disp, vcount, tier, usd, rel]) => {
  const img = dataUri(rel); if (img) cached++;
  if (usd && usd !== '') priced++;
  const tierChip = tier === 'standard'
    ? '<span class="chip chip-std">standard</span>'
    : `<span class="chip chip-sp">${esc(tier || '?')}</span>`;
  return `<article class="tile">
    <div class="art">${img ? `<img loading="lazy" src="${img}" alt="${esc(name)}">` : '<div class="ph"></div>'}</div>
    <div class="meta">
      <div class="row1"><span class="nm">${esc(name)}</span><span class="no">#${esc(lid)}</span></div>
      <div class="row2"><span class="price">${money(usd)}</span><span class="vc">${esc(vcount)} variant${vcount === '1' ? '' : 's'}</span></div>
      <div class="row3">${esc(disp)} ${tierChip}</div>
    </div>
  </article>`;
}).join('\n');

const bars = prog.map(([goal, own, tot]) => {
  const pct = tot && Number(tot) > 0 ? (100 * Number(own) / Number(tot)) : 0;
  return `<div class="bar"><div class="bl"><span>${esc(goal)}</span><span>${own}/${tot} · ${pct.toFixed(1)}%</span></div>
    <div class="track"><div class="fill" style="width:${Math.max(pct, 0.6)}%"></div></div></div>`;
}).join('\n');

const html = `<div class="wrap">
  <header class="hdr">
    <div class="badge">${esc(setId.toUpperCase())}</div>
    <div>
      <h1>${esc(setName)}</h1>
      <p class="sub">${esc(seriesName)} · ${esc(releaseDate)} · ${esc(printed)} printed + ${Number(total) - Number(printed)} secret = ${esc(total)} cards</p>
    </div>
  </header>
  <section class="prog">${bars}</section>
  <p class="note">Every card, price and image on this page was produced <strong>entirely from local Postgres and the on-disk image cache</strong> — no network was touched to build it. ${cached}/${rows.length} cards show locally-cached art; ${priced}/${rows.length} carry a locally-stored price. Prices as of the last local sync.</p>
  <section class="grid">${tiles}</section>
  <footer class="ft">pokedex · self-hosted pkmn.gg clone · data © Nintendo/TPC/Creatures/GAME FREAK, cached for personal use · TCGdex (MIT) + TCGCSV</footer>
</div>`;

const css = `
:root{--s1:#15181F;--s2:#1F232D;--s3:#282D38;--tb:#C1C7D8;--tm:#7F8596;--acc:#FFD54A;--acc2:#FFE165;--pos:#35F197;--sp:#45BCFF}
*{box-sizing:border-box}
.wrap{max-width:1100px;margin:0 auto;padding:20px;color:var(--tb);font-family:Inter,system-ui,sans-serif}
.hdr{display:flex;gap:16px;align-items:center;margin-bottom:18px}
.badge{background:#fff;color:#111;font-weight:800;border-radius:8px;padding:10px 12px;font-size:13px;letter-spacing:.5px}
h1{margin:0;font-size:26px;font-weight:700;color:#fff}
.sub{margin:4px 0 0;color:var(--tm);font-size:13px}
.prog{display:flex;flex-direction:column;gap:8px;background:var(--s2);border-radius:8px;padding:15px;margin-bottom:14px}
.bar .bl{display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px}
.bar .bl span:first-child{text-transform:capitalize;color:#fff;font-weight:550}
.track{height:8px;background:var(--s3);border-radius:8px;overflow:hidden}
.fill{height:100%;background:linear-gradient(90deg,var(--acc),var(--acc2));border-radius:8px}
.note{font-size:12.5px;line-height:1.5;color:var(--tm);background:rgba(69,188,255,.06);border:1px solid rgba(69,188,255,.2);border-radius:8px;padding:12px 14px;margin:0 0 18px}
.note strong{color:var(--tb)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px}
.tile{background:var(--s3);border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
.art{aspect-ratio:245/337;background:var(--s2)}
.art img{width:100%;height:100%;object-fit:cover;display:block}
.ph{width:100%;height:100%;background:repeating-linear-gradient(45deg,var(--s2),var(--s2) 8px,var(--s3) 8px,var(--s3) 16px)}
.meta{padding:9px 10px 11px;display:flex;flex-direction:column;gap:4px}
.row1{display:flex;justify-content:space-between;align-items:baseline;gap:6px}
.nm{font-weight:600;color:#fff;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.no{color:var(--tm);font-size:11px;flex:none}
.row2{display:flex;justify-content:space-between;align-items:baseline}
.price{color:var(--pos);font-weight:650;font-size:14px}
.vc{color:var(--tm);font-size:11px}
.row3{font-size:11px;color:var(--tm);display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip{font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;flex:none}
.chip-std{background:rgba(53,241,151,.14);color:var(--pos)}
.chip-sp{background:rgba(69,188,255,.14);color:var(--sp)}
.ft{margin-top:22px;padding-top:14px;border-top:1px solid var(--s3);color:var(--tm);font-size:11px;line-height:1.5}
@media(prefers-color-scheme:light){:root{--s1:#fff;--tb:#333}}
`;

writeFileSync(out, `<style>${css}</style>\n${html}`);
console.log(`wrote ${out}`);
console.log(`set=${setId} "${setName}" cards=${rows.length} cached-art=${cached} priced=${priced}`);
