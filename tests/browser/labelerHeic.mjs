import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { selfHostContentSecurityPolicy } from '../../apps/api/src/securityPolicy.ts'
import { serve } from './support.mjs'

const fixture = fileURLToPath(new URL('../../apps/web/src/scan/labeler/__tests__/fixtures/upright.heic', import.meta.url))
const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url))
const helmet = requireApi('helmet')

function selfHostCspHeader(policy = selfHostContentSecurityPolicy) {
  let header
  helmet.contentSecurityPolicy(policy)({}, {
    setHeader(name, value) { if (name.toLowerCase() === 'content-security-policy') header = value },
  }, () => {})
  assert.ok(header, 'Helmet produced the real self-host policy')
  return header
}

export async function checkHeicUnderSelfHostCsp(browser, dist) {
  dist = path.resolve(dist)
  const chunks = fs.readdirSync(path.join(dist, 'assets')).filter(name => /^heic-to-.*\.js$/.test(name))
  assert.equal(chunks.length, 1, 'one lazy CSP-safe HEIC decoder chunk in the self-host build')
  fs.writeFileSync(path.join(dist, 'heic-csp.html'), '<!doctype html><title>HEIC policy fixture</title>')
  fs.copyFileSync(fixture, path.join(dist, 'heic-csp.heic'))
  const oldPolicy = { ...selfHostContentSecurityPolicy, directives: {
    ...selfHostContentSecurityPolicy.directives, workerSrc: ["'self'"],
  } }
  const blockedServer = await serve(dist, '/deckpal', () => null, 'heic-csp.html', { csp: selfHostCspHeader(oldPolicy) })
  const blockedContext = await browser.newContext({ serviceWorkers: 'block' })
  try {
    const page = await blockedContext.newPage()
    await page.goto(blockedServer.origin + '/deckpal/heic-csp.html')
    const blocked = await page.evaluate(() => new Promise(resolve => {
      const url = URL.createObjectURL(new Blob(['postMessage("ready")'], { type: 'application/javascript' }))
      const worker = new Worker(url)
      worker.onerror = () => resolve(true)
      worker.onmessage = () => resolve(false)
      setTimeout(() => resolve(false), 2000)
    }))
    assert.equal(blocked, true, 'the old same-origin-only worker policy blocks blob workers')
  } finally {
    await blockedContext.close()
    await blockedServer.close()
  }
  const server = await serve(dist, '/deckpal', () => null, 'heic-csp.html', { csp: selfHostCspHeader() })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  try {
    await context.addInitScript(() => {
      const NativeWorker = Worker
      window.__heicMessageListeners = 0
      window.Worker = class extends NativeWorker {
        addEventListener(type, listener, options) {
          if (type === 'message') window.__heicMessageListeners++
          return super.addEventListener(type, listener, options)
        }
        removeEventListener(type, listener, options) {
          if (type === 'message') window.__heicMessageListeners--
          return super.removeEventListener(type, listener, options)
        }
      }
    })
    const page = await context.newPage()
    const errors = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(server.origin + '/deckpal/heic-csp.html')
    const result = await page.evaluate(async asset => {
      const response = await fetch('/deckpal/heic-csp.heic')
      const bytes = await response.arrayBuffer()
      const original = new Blob([bytes], { type: 'image/heic' })
      const corrupt = new Blob([bytes.slice(0, 36)], { type: 'image/heic' })
      const { heicTo } = await import(asset)
      const decode = blob => Promise.race([
        heicTo({ blob, type: 'image/png' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('HEIC decode did not finish')), 15_000)),
      ])
      const first = await decode(original)
      let corruptRejected = false
      try { await decode(corrupt) } catch (error) {
        if (error?.message === 'HEIC decode did not finish') throw error
        corruptRejected = true
      }
      const second = await decode(original)
      const bitmap = await createImageBitmap(second)
      const dimensions = [bitmap.width, bitmap.height]
      bitmap.close()
      const previewUrl = URL.createObjectURL(second)
      const image = new Image()
      const previewLoaded = await new Promise(resolve => {
        image.onload = () => resolve(true)
        image.onerror = () => resolve(false)
        image.src = previewUrl
        document.body.append(image)
      })
      image.remove()
      URL.revokeObjectURL(previewUrl)
      return { type: second.type, size: second.size, width: dimensions[0], height: dimensions[1],
        corruptRejected, firstSize: first.size, previewLoaded,
        messageListeners: window.__heicMessageListeners }
    }, '/deckpal/assets/' + chunks[0]).catch(error => {
      throw new Error(`${error.message}; browser console: ${errors.join(' | ')}`)
    })
    assert.equal(result.type, 'image/png')
    assert.ok(result.firstSize > 100 && result.size > 100, 'both valid decodes return image bytes')
    assert.deepEqual([result.width, result.height], [240, 360])
    assert.equal(result.corruptRejected, true, 'a corrupt HEIC fails without poisoning the next photo')
    assert.equal(result.previewLoaded, true, 'a blob-backed private photo preview displays under self-host CSP')
    assert.equal(result.messageListeners, 0, 'successful and failed conversions release worker listeners')
    assert.deepEqual(errors, [], 'strict self-host policy reports no blocked code')
    assert.deepEqual(server.unexpected, [], 'decoder fetches only local fixture assets')
    return { case: 'real-heic-under-selfhost-csp', width: result.width, height: result.height, corruptRejected: true }
  } finally {
    await context.close()
    await server.close()
  }
}
