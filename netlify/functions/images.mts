import { withLambda } from '@netlify/aws-lambda-compat'
import serverless from 'serverless-http'
import express from 'express'

import { hydrateDeckPalEnvironment } from './_shared/env.mts'

declare const Netlify: {
  env: {
    get(name: string): string | undefined
  }
}

hydrateDeckPalEnvironment((name) => Netlify.env.get(name))

// The cloud image tier for `/deckpal/images/*`. Self-host serves these URLs from
// `apps/images` off a local WebP cache; this deployment has no disk, so the
// handler fills the public Supabase Storage bucket (`CARD_ART_BUCKET`, default
// `card-art`) lazily and 302s to the CDN. It needs `SUPABASE_URL` and
// `SUPABASE_SERVICE_ROLE_KEY` — Storage writes are server-side only.
//
// Without this function `/deckpal/images/*` falls through to the SPA catch-all
// in netlify.toml and every <img> gets `200 text/html` — a silently broken grid.
// The Vercel deploy wires the same handler through `api/images.mjs`.
const { handleImageRequest } = await import('../../apps/api/dist/images/handler.js')

const app = express()
app.disable('x-powered-by')
app.use((req, res) => {
  handleImageRequest(req, res).catch((error: unknown) => {
    console.warn('[images] handler failed', error)
    if (res.headersSent) {
      res.end()
      return
    }
    res.statusCode = 500
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end('image handler error')
  })
})

export default withLambda(
  serverless(app, {
    // The hot path is a 302 with no body; the failure path is a ~1 KB WebP
    // placeholder. Both must survive the Lambda base64 round-trip intact.
    binary: ['image/*', 'application/octet-stream'],
  }),
)
