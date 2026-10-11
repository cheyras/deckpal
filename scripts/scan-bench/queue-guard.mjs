/**
 * Where queue-pull.mjs may write: anywhere but inside the repo. This is the
 * JavaScript twin of queue_paths.py, and that file's docstring explains why
 * EVERY destination is checked and not just the queue root.
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * The real, canonical location of `p`. Symlinks and junctions are resolved on
 * the longest part of the path that exists, `p` itself included when it is a
 * link. On Windows, where paths are case-insensitive, the result is
 * lower-cased, so `E:\USERS\…` cannot slip past a check written for `E:\users\…`.
 */
export function canonical(p, hops = 0) {
  let head = path.resolve(p)
  const tail = []
  // lstat, not exists: a link whose target is not there yet (a file the
  // script is about to create) still EXISTS, and it is where the write goes.
  while (!present(head)) {
    const up = path.dirname(head)
    if (up === head) break
    tail.unshift(path.basename(head))
    head = up
  }
  let real
  try {
    real = fs.realpathSync.native(head)
  } catch {
    // A dangling link: realpath cannot resolve it, so follow it by hand.
    if (hops > 40) throw new Error(`${p}: too many levels of links`)
    const target = path.resolve(path.dirname(head), fs.readlinkSync(head))
    return canonical(path.join(target, ...tail), hops + 1)
  }
  const out = path.join(real, ...tail)
  return process.platform === 'win32' ? out.toLowerCase() : out
}

function present(p) {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}

export function insideRepo(p, repoReal) {
  const r = canonical(p)
  return r === repoReal || r.startsWith(repoReal.replace(/[\\/]+$/, '') + path.sep)
}

/** `p`, if writing to it cannot land inside the repo; otherwise throws. */
export function checkedOut(p, repoReal) {
  if (insideRepo(p, repoReal)) {
    throw new Error(`${p} resolves inside the repo (${canonical(p)}); refusing to write the owner's photos there`)
  }
  return p
}
