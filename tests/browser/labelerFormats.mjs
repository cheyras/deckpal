import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminFixture, signIn } from './admin.mjs'
import { queueFixture } from './queue.mjs'
import { buildWeb, contextFor, ROOT, serve } from './support.mjs'

// Use the header shipped by Vercel, including its worker and WASM rules.
// A decoder that works in Vite's dev server can still fail on deckpal.app.
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))
const productionCsp = vercel.headers.find(entry => entry.source.startsWith('/((?!api/'))
  ?.headers.find(header => header.key === 'Content-Security-Policy')?.value
assert.ok(productionCsp, 'production CSP must be found in vercel.json')

// Synthetic colored quadrants encoded as HEIC and JPEG XL. The HEIC's irot
// property is 270 degrees, matching the recovered iPhone originals. A local
// override can exercise an original without committing its private pixels.
const heicPath = process.env.DECKPAL_REAL_HEIC_TEST_FILE
  ?? fileURLToPath(new URL('../../apps/web/src/scan/labeler/__tests__/fixtures/synthetic-irot270.heic', import.meta.url))
const heicJpegName = path.basename(heicPath).replace(/\.[^.]+$/, '.jpg')
const jxlPath = fileURLToPath(new URL('../../apps/web/src/scan/labeler/__tests__/fixtures/synthetic-jpeg-xl.jxl', import.meta.url))
const jxl = fs.readFileSync(jxlPath)
const jxlSignature = Buffer.from([0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])
const jxlMessage = "JPEG XL isn't supported yet — export as JPEG or HEIC"

function assertFixtures() {
  const heic = fs.readFileSync(heicPath)
  const rotation = heic.indexOf(Buffer.from('irot'))
  assert.ok(rotation > 0, 'HEIC fixture has an item rotation property')
  assert.equal(heic[rotation + 4], 3, 'HEIC item rotation is 270 degrees')
  assert.deepEqual(jxl.subarray(0, jxlSignature.length), jxlSignature, 'JXL fixture has the container byte signature')
}

export function browserSuites({ browser, out, scratch, results, logs }) {
  return [{
    name: 'cloud-labeler-formats',
    async run() {
      assertFixtures()
      const dist = path.join(scratch, 'cloud-labeler-formats')
      const admin = adminFixture('')
      const queue = queueFixture('')
      const server = await serve(dist, '',
        (rel, url, req) => rel.startsWith('/api/dev/scan-queue') || rel.startsWith('/api/dev/scan-flags')
          ? queue.response(rel, url, req) : admin.response(rel, url, req),
        'index.html', {
          csp: productionCsp,
          allowMutation: (pathname, method) => admin.allowMutation(pathname, method)
            || queue.allowMutation(pathname, method)
            || pathname === '/api/client-errors' && method === 'POST',
          // The normal fixture cap is for tiny JSON. A real JPEG upload is a
          // base64 body below production's 4.5 MB request ceiling.
          maxMutationChars: 4_400_000,
        })
      try {
        logs.push(await buildWeb(dist, true, server.origin))
        for (const width of [1440, 390]) {
          await checkHeic(browser, server, queue, width, out, results)
          await checkJxl(browser, server, queue, width,
            { name: 'jpeg-xl.jxl', mimeType: 'image/jxl', buffer: jxl }, 'jpeg-xl.jxl', 'extension', out, results)
          await checkJxl(browser, server, queue, width,
            { name: 'disguised.jpg', mimeType: 'image/jpeg', buffer: jxl }, 'disguised.jpg', 'signature', out, results)
        }
        assert.deepEqual(server.unexpected, [], 'format tests made no unexpected requests')
      } finally {
        await server.close()
      }
    },
  }]
}

async function signedInPage(browser, server, width) {
  const { context, page } = await contextFor(browser, server, width)
  await signIn(context)
  await context.addInitScript(() => {
    window.__formatCspViolations = []
    document.addEventListener('securitypolicyviolation', event => {
      window.__formatCspViolations.push(event.violatedDirective + ': ' + event.blockedURI)
    })
  })
  await page.goto(server.origin + '/dev/quad-labeler', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^queue/i }).click()
  return { context, page }
}

async function assertNoCspViolation(page) {
  assert.deepEqual(await page.evaluate(() => window.__formatCspViolations), [], 'production CSP blocked no labeler resources')
}

async function checkHeic(browser, server, queue, width, out, results) {
  queue.reset(0)
  const { context, page } = await signedInPage(browser, server, width)
  try {
    await page.locator('input[type="file"]').setInputFiles(heicPath)
    await page.getByRole('button', { name: `Label ${heicJpegName}` }).waitFor({ timeout: 30_000 })
    await page.getByText('1 photo waiting').waitFor()
    assert.equal(queue.state.uploads, 1, 'HEIC was converted and uploaded once')
    assert.equal(await page.getByText('local', { exact: true }).count(), 0, 'converted HEIC is in the shared queue')
    const image = page.getByRole('button', { name: `Label ${heicJpegName}` }).locator('img')
    await page.waitForFunction((jpegName) => {
      const img = document.querySelector(`button[aria-label="Label ${jpegName}"] img`)
      return img?.complete && img.naturalWidth > 0
    }, heicJpegName)
    const dimensions = await image.evaluate(img => [img.naturalWidth, img.naturalHeight])
    assert.ok(dimensions[1] > dimensions[0], `irot=270 HEIC uploaded upright, got ${dimensions}`)
    const corners = await image.evaluate(img => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const context = canvas.getContext('2d')
      context.drawImage(img, 0, 0)
      const sample = (x, y) => [...context.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3)
      return {
        topLeft: sample(canvas.width * 0.1, canvas.height * 0.1),
        topRight: sample(canvas.width * 0.9, canvas.height * 0.1),
      }
    })
    if (!process.env.DECKPAL_REAL_HEIC_TEST_FILE) {
      assert.ok(corners.topLeft[2] > corners.topLeft[0] * 3,
        `blue lower-left source quadrant rotated to top-left, got ${corners.topLeft}`)
      assert.ok(corners.topRight[0] > corners.topRight[2] * 3,
        `red upper-left source quadrant rotated to top-right, got ${corners.topRight}`)
    }
    await assertNoCspViolation(page)
    await page.screenshot({ path: path.join(out, `labeler-heic-cloud-csp-${width}.png`), fullPage: true })
    results.push({ case: 'labeler-heic-irot270-cloud-csp', label: 'cloud', width, dimensions, corners })
  } finally {
    await context.close()
  }
}

async function checkJxl(browser, server, queue, width, input, name, variant, out, results) {
  queue.reset(0)
  const { context, page } = await signedInPage(browser, server, width)
  try {
    await page.locator('input[type="file"]').setInputFiles(input)
    const item = page.getByRole('button', { name: `${name} cannot be uploaded` }).locator('..')
    await item.getByText(jxlMessage, { exact: true }).waitFor({ timeout: 30_000 })
    assert.equal(queue.state.uploads, 0, 'JPEG XL bytes never reached the JPEG-only API')
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^queue/i }).click()
    await item.getByText(jxlMessage, { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: `Discard ${name}` }).isVisible(), true,
      'permanent failure keeps its Discard action after a reload')
    assert.equal(queue.state.uploads, 0, 'reload does not retry a permanently unsupported photo')
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await item.getByText(jxlMessage, { exact: true }).waitFor()
    assert.equal(queue.state.uploads, 0, 'reconnect does not retry a permanently unsupported photo')
    await assertNoCspViolation(page)
    if (variant === 'extension') {
      await page.screenshot({ path: path.join(out, `labeler-jxl-error-cloud-csp-${width}.png`), fullPage: true })
    }
    await page.getByRole('button', { name: `Discard ${name}` }).click()
    await page.getByText('Nothing queued.').waitFor()
    results.push({ case: 'labeler-jxl-permanent-error-cloud-csp', label: 'cloud', width, scenario: variant })
  } finally {
    await context.close()
  }
}
