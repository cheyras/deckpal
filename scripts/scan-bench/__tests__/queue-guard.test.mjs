// node --test scripts/scan-bench/__tests__/queue-guard.test.mjs
//
// queue-pull.mjs's write guard (queue-guard.mjs), offline: a temporary
// directory stands in for the repo, so nothing here touches the checkout.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { canonical, checkedOut, insideRepo } from '../queue-guard.mjs'

let tmp, repo, repoReal, queue
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-guard-'))
  repo = path.join(tmp, 'fake-repo')
  fs.mkdirSync(path.join(repo, 'inside'), { recursive: true })
  repoReal = canonical(repo)
  queue = path.join(tmp, 'queue')
  fs.mkdirSync(queue)
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('queue-pull write guard', () => {
  it('refuses the repo itself and anything under it', () => {
    assert.equal(insideRepo(repo, repoReal), true)
    assert.equal(insideRepo(path.join(repo, 'inside', 'listing.json'), repoReal), true)
    assert.throws(() => checkedOut(repo, repoReal), /inside the repo/)
  })

  it('allows the queue, and a sibling whose name only starts like the repo', () => {
    assert.equal(checkedOut(path.join(queue, 'listing.json'), repoReal), path.join(queue, 'listing.json'))
    assert.equal(insideRepo(repo + '-sibling', repoReal), false)
  })

  it('refuses a different-case spelling of the repo on Windows', { skip: process.platform !== 'win32' }, () => {
    assert.equal(insideRepo(repo.toUpperCase(), repoReal), true)
    assert.equal(insideRepo(path.join(repo.toUpperCase(), 'raw'), repoReal), true)
  })

  it('refuses a child directory that is a junction into the repo, and files under it', () => {
    const raw = path.join(queue, 'raw')
    fs.symlinkSync(path.join(repo, 'inside'), raw, 'junction')
    assert.throws(() => checkedOut(raw, repoReal), /inside the repo/)
    assert.throws(() => checkedOut(path.join(raw, '123.jpg.tmp'), repoReal), /inside the repo/)
    assert.throws(() => checkedOut(path.join(raw, '123.json'), repoReal), /inside the repo/)
  })

  it('refuses a child file that is a symlink into the repo', (t) => {
    const listing = path.join(queue, 'listing.json')
    try {
      fs.symlinkSync(path.join(repo, 'listing.json'), listing, 'file')
    } catch {
      t.skip('file symlinks need a privilege this shell does not have')
      return
    }
    // The target does not exist yet: the write would CREATE it, in the repo.
    assert.throws(() => checkedOut(listing, repoReal), /inside the repo/)
  })

  it('refuses a dangling junction child too', () => {
    const cards = path.join(queue, 'cards')
    fs.symlinkSync(path.join(repo, 'not-yet'), cards, 'junction')
    assert.throws(() => checkedOut(path.join(cards, 'a.jpg'), repoReal), /inside the repo/)
  })
})
