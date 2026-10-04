#!/usr/bin/env node
/**
 * gen-landing-photos.mjs — the landing page's photographs.
 *
 * Round 1 (2026-10-03) was eight "league night" shots at one game store; only the
 * hero and closing bands survive. Round 2 (2026-10-04) replaced the rest with
 * five backdrops for the Plan / Playtest / Tune / Build / Ask panels,
 * deliberately varied in place, light and camera angle (top-down flat lays, a
 * night desk, a kitchen counter, a couch), with the subject toward the edges so
 * the panel placed in the centre has calm ground behind it.
 *
 * Scenes are generated through the Vercel AI Gateway with every readable card
 * left BLANK (plain white faces). Real card art is composited onto those faces
 * afterwards by tools/landing-photos/composite.py, which uses the blank face as
 * the lighting map, so no card text on the page is ever model-generated.
 *
 *   node scripts/gen-landing-photos.mjs generate --only plan --model google/gemini-3-pro-image --n 3
 *   node scripts/gen-landing-photos.mjs list
 *   node scripts/gen-landing-photos.mjs encode      # finals -> AVIF/WebP + MANIFEST.json
 *   node scripts/gen-landing-photos.mjs encode --only plan,ask   # just these finals
 *   node scripts/gen-landing-photos.mjs manifest    # rebuild MANIFEST.json after removing files
 *
 * Raw candidates land in .marketing-raw/landing/<shot>/ (gitignored).
 *
 * Auth: AI_GATEWAY_API_KEY, else DECKPAL_DEV_VERCEL_AI_GATEWAY_KEY from .env.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { generateImage, generateText } from 'ai';
import sharp from 'sharp';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(REPO_ROOT, '.marketing-raw', 'landing');
const FINAL_DIR = path.join(RAW_DIR, 'final');
const OUT_DIR = path.join(REPO_ROOT, 'apps', 'web', 'public', 'marketing', 'landing');

/** Responsive widths per shot; the full-bleed bands get the wide set. */
const WIDTHS = { hero: [2560, 1600, 960], closing: [2560, 1600, 960] };
const DEFAULT_WIDTHS = [1600, 960, 640];
const BUDGET_KB = 250; // at the largest width; smaller widths scale by area

/** Round 1: one grade for the store shots, so they read as one night at one store. */
const GRADE =
  'Shot on a full-frame camera with a 35mm lens at f/2.8, natural available light at a local game store on league night: ' +
  'warm tungsten overhead light around 3200K, soft falloff, gentle film grain, true-to-life color, slightly lifted blacks. ' +
  'Candid documentary photograph, not a render, not an illustration.';

/** Readable cards are composited later; the model must leave them blank. */
const BLANK_CARDS =
  'Every face-up trading card in the frame is a completely blank card: a plain, uniform matte white face with no printing, ' +
  'no artwork, no border, no text and no symbols, standard 63x88mm proportions with slightly rounded corners, ' +
  'each in a clear glossy penny sleeve. Face-down cards show only a plain solid dark navy sleeve back with no pattern.';

const NEGATIVE =
  'No text anywhere, no letters, no numbers, no logos, no brand names, no watermarks. ' +
  'No recognizable characters or creatures. No printed card designs.';

/** Round 2: each backdrop gets the light of its own place, not the store's. */
const FILM = 'gentle film grain, true-to-life color, slightly lifted blacks. Candid photograph of a real home, not a render, not an illustration, not a studio product shot.';
const GRADE_DAY = `Shot on a full-frame camera with a 35mm lens, soft natural daylight from a nearby window, gentle soft shadows, ${FILM}`;
const GRADE_NIGHT = `Shot on a full-frame camera with a 35mm lens at f/2.8, at night, lit only by a warm desk lamp around 2700K from one side, a warm pool of light with soft falloff into shadow, ${FILM}`;
const GRADE_EVENING = `Shot on a full-frame camera with a 35mm lens at f/2, evening at home, warm table lamp light around 2700K, soft background blur, ${FILM}`;

/** Deck sleeves rather than penny sleeves, for the at-home deck shots. */
const BLANK_DECK =
  'Every face-up card is a completely blank card: a plain, uniform matte white face with no printing, no artwork, no border, ' +
  'no text and no symbols, standard 63x88mm proportions with slightly rounded corners, inside a matte black deck sleeve ' +
  'whose clear front shows the white face and whose thin black edge frames it. Face-down cards show only the plain solid black sleeve back with no pattern.';

/** These photos sit behind a UI panel placed in their centre. */
const BACKDROP =
  'Composition: the photo is a backdrop behind a panel centred on top of it, so the objects read around the edges and corners of the frame ' +
  'and the middle of the frame is calmer and less busy.';

const NO_PEOPLE = 'No people in the frame, no faces, no other hands.';

export const SHOTS = {
  hero: {
    aspect: '3:2',
    imageSize: '4K',
    size: '1536x1024',
    prompt:
      "A first-person view from the player's seat looking down and forward across a black cloth playmat on a wooden table at league night. " +
      'On the mat: one face-up card in the active spot near the center, a row of four face-up cards on the bench closer to the camera, ' +
      'a face-down sleeved deck on the right, six face-down prize cards in two neat columns on the left, a few blank damage counters and one die. ' +
      'Across the table, softly out of focus, the opponent’s hands and their own plain black playmat. The bottom fifth of the frame is the near edge of the table, ' +
      'calm and slightly dark, leaving room for a phone to lean into frame later. ' +
      BLANK_CARDS + ' ' + GRADE + ' ' + NEGATIVE,
  },
  closing: {
    aspect: '21:9',
    imageSize: '4K',
    size: '1536x1024',
    prompt:
      'Wide, low-angle photograph across a long league table with several black playmats in a row, cards and dice on them, ' +
      'the room glowing warm behind, no people in focus. Calm open space across the middle of the frame for a headline. ' +
      BLANK_CARDS + ' ' + GRADE + ' ' + NEGATIVE,
  },

  // ---- Round 2: panel backdrops, one place and one camera angle each.
  plan: {
    aspect: '4:3',
    size: '1536x1152',
    prompt:
      'Straight top-down flat lay photograph, the camera pointing directly down at a light oak wooden desk at home in soft morning daylight. ' +
      'An open zip-around nine-pocket trading card binder lies perfectly flat with both facing pages fully visible, each page a neat 3x3 grid of clear pockets ' +
      'with black page backing, so the dark gaps between all eighteen pockets are clearly visible; every pocket holds one card, all upright in the same orientation. ' +
      'The binder takes up the left two thirds of the frame. Along the right edge: a closed plain matte charcoal deck box, ' +
      'an unopened clear plastic packet of card sleeves with no label and no printing, and a smartphone lying face down showing its plain back with no logo. ' +
      'A small ceramic mug near a corner. ' +
      BLANK_CARDS + ' ' + BACKDROP + ' ' + NO_PEOPLE + ' ' + GRADE_DAY + ' ' + NEGATIVE,
  },
  playtest: {
    aspect: '4:3',
    size: '1536x1152',
    prompt:
      'Three-quarter overhead photograph, looking down at about 50 degrees, of a home desk at night. ' +
      'A squared-up sixty-card deck in black sleeves with its top card face up sits beside an open plain matte black deck box with its lid off, ' +
      'toward the lower right of the frame. A closed laptop with a plain unbranded lid, no logo, lies shut at the top left, nothing lit on it. ' +
      'A warm desk lamp at the right edge throws a pool of light across dark walnut wood; a mug and a pencil nearby. ' +
      'The middle of the desk is calm, open wood fading into shadow. ' +
      BLANK_DECK + ' ' + BACKDROP + ' ' + NO_PEOPLE + ' ' + GRADE_NIGHT + ' ' + NEGATIVE,
  },
  tune: {
    aspect: '4:3',
    size: '1536x1152',
    prompt:
      'High-angle, nearly top-down photograph at home of a deck being tuned on a plain dark slate-grey cloth playmat on a desk. ' +
      'Twenty face-up sleeved cards are laid out in four neat rows of five with small even gaps, every card upright and facing the camera. ' +
      'Three more face-up cards are pulled out and set apart near the right edge in a small loose column. ' +
      'A smartphone lies near a corner with its screen completely black and switched off, and the rest of the deck sits in a squared face-down stack. ' +
      BLANK_DECK + ' ' + NO_PEOPLE + ' ' + GRADE_DAY + ' ' + NEGATIVE,
  },
  build: {
    aspect: '4:3',
    size: '1536x1152',
    prompt:
      'High-angle photograph looking down at a bright white stone kitchen counter in daylight. ' +
      'A torn-open padded mailer envelope of plain kraft paper, with no label, no address, no stamps and no printing, lies near the top left corner, ' +
      'and five single trading cards, each in a rigid clear plastic toploader, have spilled out of it in a loose overlapping fan running toward the right edge, ' +
      'all five face up and upright. A smartphone with its screen black and switched off lies near the bottom right corner. ' +
      'A fruit bowl and a small plant soft and out of focus at the top edge. ' +
      BLANK_CARDS + ' ' + BACKDROP + ' ' + NO_PEOPLE + ' ' + GRADE_DAY + ' ' + NEGATIVE,
  },
  ask: {
    aspect: '3:2',
    size: '1536x1024',
    prompt:
      "First-person photograph from the player's own eyes, sitting on a couch at home in the evening: their own left hand, seen from above, " +
      'holds seven sleeved cards fanned in a smooth even arc, the thumb resting across the front of the fan near its base. ' +
      'The hand and fan sit in the right half of the frame. Behind, softly out of focus: a warm table lamp glowing, a cushion, a knit throw, ' +
      'a low coffee table with a closed deck box on it. The seven cards overlap like a hand of cards, each card face fully blank. ' +
      'Only this one hand in the frame; no other people, no faces. ' +
      BLANK_CARDS + ' ' + BACKDROP + ' ' + GRADE_EVENING + ' ' + NEGATIVE,
  },
};

function ensureAuth() {
  if (process.env.AI_GATEWAY_API_KEY) return;
  for (const file of [path.join(REPO_ROOT, '.env')]) {
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, 'utf8').match(/^DECKPAL_DEV_VERCEL_AI_GATEWAY_KEY=(.*)$/m);
    if (m) {
      process.env.AI_GATEWAY_API_KEY = m[1].trim().replace(/^["']|["']$/g, '');
      return;
    }
  }
  throw new Error('No AI Gateway key: set AI_GATEWAY_API_KEY or DECKPAL_DEV_VERCEL_AI_GATEWAY_KEY in .env');
}

const isGemini = (model) => model.startsWith('google/');

/** Gemini image models are language models on the gateway and return image files. */
async function renderOnce(model, shot, prompt, refs) {
  if (isGemini(model)) {
    const content = [{ type: 'text', text: `${prompt}\n\nAspect ratio ${shot.aspect}.` }];
    for (const r of refs) content.push({ type: 'image', image: fs.readFileSync(r) });
    const res = await generateText({
      model,
      messages: [{ role: 'user', content }],
      providerOptions: { google: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: shot.aspect, imageSize: shot.imageSize ?? '2K' } } },
    });
    const file = res.files.find((f) => f.mediaType?.startsWith('image/'));
    if (!file) throw new Error(`no image returned (${res.text?.slice(0, 120) ?? ''})`);
    return Buffer.from(file.uint8Array);
  }
  const promptArg = refs.length ? { text: prompt, images: refs.map((r) => fs.readFileSync(r)) } : prompt;
  const base = { model, prompt: promptArg, providerOptions: { gateway: { tags: ['feature:landing-photos'] } } };
  const sized = model.startsWith('openai/') ? { size: shot.size } : { aspectRatio: shot.aspect };
  const res = await generateImage({ ...base, ...sized });
  return Buffer.from(res.images[0].base64, 'base64');
}

async function generate({ only, model, n, tag, refs, extra }) {
  ensureAuth();
  const names = only ? only.split(',') : Object.keys(SHOTS);
  for (const name of names) {
    const shot = SHOTS[name];
    if (!shot) throw new Error(`unknown shot ${name}`);
    const dir = path.join(RAW_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    const prompt = extra ? `${shot.prompt} ${extra}` : shot.prompt;
    const jobs = Array.from({ length: n }, async (_, i) => {
      const started = Date.now();
      const slug = model.split('/')[1];
      const file = path.join(dir, `${slug}${tag ? '-' + tag : ''}-${Date.now().toString(36)}-${i}.png`);
      try {
        const buf = await renderOnce(model, shot, prompt, refs);
        fs.writeFileSync(file, buf);
        console.log(`${name}: ${path.relative(REPO_ROOT, file)} ${(buf.length / 1024).toFixed(0)}KB ${((Date.now() - started) / 1000).toFixed(0)}s`);
      } catch (err) {
        console.error(`${name}: ${model} FAILED ${err?.statusCode ?? ''} ${String(err?.message ?? err).slice(0, 300)}`);
      }
    });
    await Promise.all(jobs);
  }
}

/**
 * Composited finals (.marketing-raw/landing/final/<shot>.png, written by
 * tools/landing-photos/composite.py) -> responsive AVIF + WebP in
 * apps/web/public/marketing/landing/, then a MANIFEST.json measured from the
 * files on disk. Quality steps down only until a file fits its byte budget.
 * `only` limits which finals are (re-)encoded; the manifest always covers
 * every file in the directory.
 */
async function encode({ only } = {}) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let shots = fs.readdirSync(FINAL_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort();
  if (only) {
    const want = only.split(',');
    for (const w of want) if (!shots.includes(w)) throw new Error(`no final for ${w} in ${path.relative(REPO_ROOT, FINAL_DIR)}`);
    shots = shots.filter((s) => want.includes(s));
  }
  for (const shot of shots) {
    const src = path.join(FINAL_DIR, `${shot}.png`);
    const meta = await sharp(src).metadata();
    const widths = WIDTHS[shot] ?? DEFAULT_WIDTHS;
    for (const width of widths) {
      const w = Math.min(width, meta.width);
      const budget = BUDGET_KB * 1024 * (w / widths[0]) ** 2;
      for (const format of ['avif', 'webp']) {
        const ladder = format === 'avif' ? [60, 54, 48, 42, 36] : [82, 76, 70, 64, 58];
        let buf, q;
        for (q of ladder) {
          const pipe = sharp(src).resize({ width: w, kernel: 'lanczos3' });
          buf = await (format === 'avif'
            ? pipe.avif({ quality: q, effort: 6, chromaSubsampling: '4:2:0' })
            : pipe.webp({ quality: q, effort: 6, smartSubsample: true })
          ).toBuffer();
          if (buf.length <= budget) break;
        }
        fs.writeFileSync(path.join(OUT_DIR, `${shot}-${width}.${format}`), buf);
        console.log(`${shot}-${width}.${format}  q${q}  ${(buf.length / 1024).toFixed(0)}KB`);
      }
    }
  }
  await writeManifest();
}

async function writeManifest() {
  const files = fs.readdirSync(OUT_DIR).filter((f) => /\.(avif|webp)$/.test(f)).sort();
  const assets = {};
  for (const file of files) {
    const full = path.join(OUT_DIR, file);
    const m = file.match(/^(.+)-(\d+)\.(avif|webp)$/);
    if (!m) continue;
    const meta = await sharp(full).metadata();
    const format = m[3]; // sharp reports AVIF as heif; trust the extension we wrote
    assets[m[1]] ??= { name: m[1], sources: [] };
    assets[m[1]].sources.push({
      file,
      path: `/marketing/landing/${file}`,
      width: meta.width,
      height: meta.height,
      format,
      mimeType: `image/${format}`,
      bytes: fs.statSync(full).size,
    });
  }
  for (const a of Object.values(assets)) {
    a.sources.sort((x, y) => y.width - x.width || x.format.localeCompare(y.format));
    a.widths = [...new Set(a.sources.map((s) => s.width))];
    a.intrinsicWidth = a.sources[0].width;
    a.intrinsicHeight = a.sources[0].height;
    a.aspectRatio = +(a.intrinsicWidth / a.intrinsicHeight).toFixed(4);
  }
  const out = {
    $comment:
      'Generated by scripts/gen-landing-photos.mjs encode. Do not hand-edit; dimensions and bytes are measured from disk.',
    generatedAt: new Date().toISOString(),
    baseUrl: '/marketing/landing/',
    assets: Object.values(assets).sort((a, b) => a.name.localeCompare(b.name)),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'MANIFEST.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`MANIFEST.json: ${out.assets.length} assets, ${files.length} files`);
}

async function main() {
  const [cmd = 'list', ...rest] = process.argv.slice(2);
  const flag = (k) => {
    const i = rest.indexOf(k);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (cmd === 'list') {
    for (const [k, v] of Object.entries(SHOTS)) console.log(`${k}\t${v.aspect}`);
    return;
  }
  if (cmd === 'manifest') {
    await writeManifest();
    return;
  }
  if (cmd === 'encode') {
    await encode({ only: flag('--only') });
    return;
  }
  if (cmd === 'generate') {
    await generate({
      only: flag('--only'),
      model: flag('--model') ?? 'openai/gpt-image-2',
      n: Number(flag('--n') ?? 1),
      tag: flag('--tag'),
      refs: (flag('--refs') ?? '').split(',').filter(Boolean),
      extra: flag('--extra'),
    });
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
