import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import {
  hydrateDeckPalEnvironment,
  missingRequiredEnvironment,
} from './env.mts'

const managedKeys = [
  'DATABASE_URL',
  'SUPABASE_MODE',
  'SUPABASE_JWT_SECRET',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'API_BASE_PATH',
] as const

type ManagedKey = (typeof managedKeys)[number]

describe('Netlify environment bridge', () => {
  const original = new Map<ManagedKey, string | undefined>()

  beforeEach(() => {
    for (const key of managedKeys) {
      original.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of managedKeys) {
      const value = original.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    original.clear()
  })

  it('copies only non-empty allowlisted values and applies Netlify defaults', () => {
    const values: Record<string, string | undefined> = {
      DATABASE_URL: 'postgres://family',
      SUPABASE_JWT_SECRET: 'secret',
      VITE_SUPABASE_URL: 'https://family.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      UNRELATED_SECRET: 'must-not-copy',
      API_BASE_PATH: '   ',
    }

    hydrateDeckPalEnvironment((name) => values[name])

    assert.equal(process.env.DATABASE_URL, 'postgres://family')
    assert.equal(process.env.SUPABASE_MODE, 'true')
    assert.equal(process.env.API_BASE_PATH, '/api')
    assert.equal(process.env.UNRELATED_SECRET, undefined)
  })

  it('never overwrites an existing process value', () => {
    process.env.DATABASE_URL = 'postgres://local'

    hydrateDeckPalEnvironment((name) =>
      name === 'DATABASE_URL' ? 'postgres://netlify' : undefined,
    )

    assert.equal(process.env.DATABASE_URL, 'postgres://local')
  })

  it('reports every required Supabase value that is absent', () => {
    hydrateDeckPalEnvironment(() => undefined)

    assert.deepEqual(missingRequiredEnvironment(), [
      'DATABASE_URL',
      'SUPABASE_JWT_SECRET',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
    ])
  })

  it('does not require Supabase values when Supabase mode is disabled', () => {
    process.env.SUPABASE_MODE = 'false'

    assert.deepEqual(missingRequiredEnvironment(), [])
  })
})
