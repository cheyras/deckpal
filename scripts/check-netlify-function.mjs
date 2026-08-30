import assert from 'node:assert/strict'

// Netlify Functions provides this global at runtime. The smoke check supplies
// the same narrow interface without reading or inventing secret values.
globalThis.Netlify = {
  env: {
    get: (name) => process.env[name],
  },
}

const module = await import('../netlify/functions/api.mts')

assert.equal(typeof module.default, 'function', 'API default export must be callable')
assert.equal(
  Object.hasOwn(module, 'handler'),
  false,
  'modern Netlify Functions must not expose a named legacy handler',
)

console.log('Netlify API function loaded successfully')
