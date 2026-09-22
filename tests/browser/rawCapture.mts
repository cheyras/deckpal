import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js'

const root = process.cwd()
const outputDir = path.join(root, '.cache/raw-capture')
await mkdir(outputDir, { recursive: true })

const html = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>DeckPal raw capture proof</title>
<style>
  body { margin:0; background:#101820; color:#f4f0df; font:16px system-ui; }
  main { max-width:1100px; margin:auto; padding:24px; }
  h1 { font-size:clamp(24px,5vw,42px); margin:0 0 8px; }
  #status { color:#70e1a1; font-weight:700; }
  .proof { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; margin-top:20px; }
  figure { margin:0; padding:12px; border:1px solid #52606d; border-radius:12px; background:#192630; }
  canvas,img { width:100%; height:auto; display:block; border-radius:7px; }
  figcaption { margin-top:8px; }
  @media(max-width:560px) { main{padding:14px}.proof{grid-template-columns:1fr} }
</style>
<main><h1>Lossless scanner handoff</h1><div id="status">running…</div>
<div class="proof"><figure><canvas id="raw"></canvas><figcaption>Pre-JPEG RGBA</figcaption></figure>
<figure><img id="jpeg"><figcaption>Existing JPEG identity body</figcaption></figure></div></main>
<script type="module">
import { CAPTURE_MARGIN, expandQuad, rectifyImageData, rectifyToCapture, rectifyToJpeg } from '/src/scan/engine/rectify.ts';

const source = document.createElement('canvas'); source.width=400; source.height=460;
const ctx = source.getContext('2d');
ctx.fillStyle='#152535'; ctx.fillRect(0,0,400,460);
ctx.fillStyle='#f9e35c'; ctx.fillRect(75,45,250,350);
for(let y=0;y<7;y++) for(let x=0;x<5;x++) {
  ctx.fillStyle='rgb('+((x*53+y*17)%256)+','+((x*11+y*67)%256)+','+((x*89+y*23)%256)+')';
  ctx.fillRect(75+x*50,45+y*50,50,50);
}
ctx.fillStyle='#fff'; ctx.font='bold 30px sans-serif'; ctx.fillText('DECKPAL',105,92);
const src=ctx.getImageData(0,0,400,460);
const quad=[[75,45],[325,45],[325,395],[75,395]];

async function decoded(blob) { const bitmap=await createImageBitmap(blob); const c=document.createElement('canvas'); c.width=bitmap.width;c.height=bitmap.height;const x=c.getContext('2d');x.drawImage(bitmap,0,0);return {width:bitmap.width,height:bitmap.height,data:x.getImageData(0,0,c.width,c.height).data}; }
function meanDiff(a,b) { let sum=0, n=0; for(let i=0;i<a.length;i+=4) for(let c=0;c<3;c++){sum+=Math.abs(a[i+c]-b[i+c]);n++;} return sum/n; }

const offscreen=await rectifyToCapture(src,quad);
if(!offscreen) throw new Error('real OffscreenCanvas path returned null');
const expected=rectifyImageData(src,expandQuad(quad,CAPTURE_MARGIN),offscreen.raw.width,offscreen.raw.height);
if(!expected || expected.data.some((v,i)=>v!==offscreen.raw.data[i])) throw new Error('raw pixels differ from direct pre-encoding rectification');
const second=await rectifyToCapture(src,quad);
if(!second || second.raw.data===offscreen.raw.data) throw new Error('captures shared their raw buffer');
const decodedOffscreen=await decoded(offscreen.blob);
if(offscreen.blob.type!=='image/jpeg' || decodedOffscreen.width!==offscreen.raw.width || decodedOffscreen.height!==offscreen.raw.height) throw new Error('Offscreen JPEG contract changed');
const offscreenMae=meanDiff(offscreen.raw.data,decodedOffscreen.data);
if(!(offscreenMae>0.05 && offscreenMae<30)) throw new Error('unexpected JPEG decode delta '+offscreenMae);

const nativeOffscreen=globalThis.OffscreenCanvas;
Object.defineProperty(globalThis,'OffscreenCanvas',{configurable:true,value:undefined});
let fallback, wrapper;
try { fallback=await rectifyToCapture(src,quad); wrapper=await rectifyToJpeg(src,quad); }
finally { Object.defineProperty(globalThis,'OffscreenCanvas',{configurable:true,value:nativeOffscreen}); }
if(!fallback || !wrapper) throw new Error('real DOM canvas fallback returned null');
const decodedFallback=await decoded(fallback.blob);
if(fallback.blob.type!=='image/jpeg' || wrapper.type!=='image/jpeg' || decodedFallback.width!==480 || decodedFallback.height!==670) throw new Error('DOM JPEG/wrapper contract changed');
if(fallback.raw.data.some((v,i)=>v!==offscreen.raw.data[i])) throw new Error('canvas paths produced different raw pixels');
const fallbackMae=meanDiff(fallback.raw.data,decodedFallback.data);
if(!(fallbackMae>0.05 && fallbackMae<30)) throw new Error('DOM JPEG decode tolerance failed '+fallbackMae);

const rawCanvas=document.querySelector('#raw'); rawCanvas.width=offscreen.raw.width;rawCanvas.height=offscreen.raw.height;
rawCanvas.getContext('2d').putImageData(new ImageData(offscreen.raw.data,offscreen.raw.width,offscreen.raw.height),0,0);
document.querySelector('#jpeg').src=URL.createObjectURL(offscreen.blob);
document.querySelector('#status').textContent='PASS · OffscreenCanvas + DOM fallback · '+offscreen.raw.width+'×'+offscreen.raw.height;
globalThis.__proof={offscreen:{mime:offscreen.blob.type,width:decodedOffscreen.width,height:decodedOffscreen.height,decodeMae:offscreenMae},domFallback:{mime:fallback.blob.type,width:decodedFallback.width,height:decodedFallback.height,decodeMae:fallbackMae},rawMatchesPreEncoding:true,independentBuffers:true,wrapperCompatible:true,externalRequests:0};
</script>`

const server = await createServer({
  root: path.join(root, 'apps/web'),
  configFile: false,
  appType: 'custom',
  server: { host: '127.0.0.1', port: 0, strictPort: true },
  plugins: [{
    name: 'raw-capture-local-fixture',
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url !== '/') return next()
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(html)
      })
    },
  }],
})

let browser
try {
  await server.listen()
  const address = server.httpServer?.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch()
  const results: Record<string, unknown> = {}
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
    const page = await browser.newPage({ viewport: { width, height } })
    let externalRequests = 0
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.hostname === '127.0.0.1') await route.continue()
      else { externalRequests++; await route.abort('blockedbyclient') }
    })
    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Boolean((globalThis as { __proof?: unknown }).__proof))
    assert.equal(externalRequests, 0, `${name} attempted an external request`)
    const proof = await page.evaluate(() => (globalThis as { __proof: unknown }).__proof)
    await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true })
    results[name] = { viewport: { width, height }, ...proof as object }
    await page.close()
  }
  await writeFile(path.join(outputDir, 'browser-proof.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2))
  console.log('PASS raw capture in Chromium at 1280 and 390; proof in .cache/raw-capture')
} finally {
  await browser?.close()
  await server.close()
}
