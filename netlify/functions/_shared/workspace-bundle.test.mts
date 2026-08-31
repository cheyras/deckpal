import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'

const apiSource = resolve(import.meta.dirname, '../../../apps/api/src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (name === '__tests__') return []
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}

test('Netlify API runtime uses a relative workspace bridge instead of a pnpm symlink', () => {
  const offenders = sourceFiles(apiSource)
    .filter((path) =>
      /from\s+['"]@deckpal\/(?:db|storage)['"]/.test(readFileSync(path, 'utf8')),
    )
    .map((path) => relative(apiSource, path))

  assert.deepEqual(
    offenders,
    [],
    `bare workspace imports become absolute Windows symlinks in Netlify zips: ${offenders.join(', ')}`,
  )
})
