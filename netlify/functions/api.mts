import { withLambda } from '@netlify/aws-lambda-compat'
import serverless from 'serverless-http'

import {
  hydrateDeckPalEnvironment,
  missingRequiredEnvironment,
} from './_shared/env.mts'

declare const Netlify: {
  env: {
    get(name: string): string | undefined
  }
}

hydrateDeckPalEnvironment((name) => Netlify.env.get(name))

const missing = missingRequiredEnvironment()
if (missing.length > 0) {
  console.warn(`[deckpal-family] missing environment: ${missing.join(', ')}`)
}

const { createApp } = await import('../../apps/api/dist/index.js')

export default withLambda(serverless(createApp()))
