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
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGSSLMODE',
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

  it('maps DATABASE_URL into the PG variables consumed by DeckPal', () => {
    hydrateDeckPalEnvironment((name) =>
      name === 'DATABASE_URL'
        ? 'postgresql://postgres.family:p%3Dword@pooler.example.com:5432/postgres?sslmode=require'
        : undefined,
    )

    assert.equal(process.env.PGHOST, 'pooler.example.com')
    assert.equal(process.env.PGPORT, '5432')
    assert.equal(process.env.PGDATABASE, 'postgres')
    assert.equal(process.env.PGUSER, 'postgres.family')
    assert.equal(process.env.PGPASSWORD, 'p=word')
    assert.equal(process.env.PGSSLMODE, 'require')
  })

  it('does not let DATABASE_URL overwrite explicit PG variables', () => {
    process.env.PGHOST = 'explicit.example.com'

    hydrateDeckPalEnvironment((name) =>
      name === 'DATABASE_URL'
        ? 'postgresql://postgres.family:secret@pooler.example.com:5432/postgres'
        : undefined,
    )

    assert.equal(process.env.PGHOST, 'explicit.example.com')
  })

  it('reports every required Supabase value that is absent', () => {
    hydrateDeckPalEnvironment(() => undefined)

    assert.deepEqual(missingRequiredEnvironment(), [
      'DATABASE_URL',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
    ])
  })

  it('accepts modern Supabase ES256/JWKS auth without a legacy JWT secret', () => {
    process.env.DATABASE_URL = 'postgres://family'
    process.env.VITE_SUPABASE_URL = 'https://family.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'anon'

    hydrateDeckPalEnvironment(() => undefined)

    assert.deepEqual(missingRequiredEnvironment(), [])
  })

  it('does not require Supabase values when Supabase mode is disabled', () => {
    process.env.SUPABASE_MODE = 'false'

    assert.deepEqual(missingRequiredEnvironment(), [])
  })
})
