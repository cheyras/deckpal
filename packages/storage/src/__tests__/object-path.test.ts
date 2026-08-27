import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_OBJECT_PATH_LENGTH,
  assertSafeObjectPath,
  isSafeObjectPath,
  objectPathProblem,
  storageOrigin,
  storageUrl,
} from '../object-path.js';
import { cardRelativePath, setImageRelativePath, spriteRelativePath } from '../paths.js';

/**
 * The object-key allow-list at the Storage choke points (CodeQL js/request-forgery
 * #37, #60, #39).
 *
 * Two halves, and the second is the one that would have been easy to skip:
 *
 *  1. every shape `paths.ts` can PRODUCE is accepted — because the assertion
 *     stands in front of `objectExists`/`uploadObject`/`moveObject`, so anything
 *     it rejects is an asset the bulk paths can no longer address. A too-strict
 *     guard here is a production outage, not a safe default;
 *  2. every traversal / injection shape is rejected, and rejected by THROWING,
 *     so it cannot be mistaken for "the object is not there".
 */

describe('objectPathProblem — real keys are accepted', () => {
  it('accepts every path shape paths.ts derives', () => {
    const real = [
      cardRelativePath({ serie: 'sv', set: 'sv03.5', localId: '102' }, 'low'),
      cardRelativePath({ serie: 'sv', set: 'sv03.5', localId: '102' }, 'high'),
      cardRelativePath({ serie: 'tk', set: 'tk-bw-e', localId: 'TG05' }, 'low'),
      cardRelativePath({ serie: 'base', set: 'base1', localId: '4' }, 'high'),
      // The upstream re-key that produced moveObject in the first place.
      cardRelativePath({ serie: 'swsh', set: 'swsh9tg', localId: '001' }, 'low'),
      setImageRelativePath('swsh9tg', 'logo'),
      setImageRelativePath('sv03.5', 'symbol'),
      setImageRelativePath('P-A', 'logo'),
      spriteRelativePath('pixel', '25', false),
      spriteRelativePath('pixel', '25', true),
      spriteRelativePath('art', '150', false),
      spriteRelativePath('art', '150', true), // sprites/other/official-artwork/shiny/150.png
    ];
    for (const key of real) {
      assert.equal(objectPathProblem(key), null, `${key} must be addressable`);
    }
  });

  it('accepts the fixed prefixes the bulk paths filter on', () => {
    // `storage:backfill --prefix images` and `manifest:check --object-store`
    // build LIKE patterns from these; they are also legal keys on their own.
    for (const key of ['images', 'sets', 'sprites', 'images/en/sv/sv03.5/102.low.webp']) {
      assert.ok(isSafeObjectPath(key), key);
    }
  });
});

describe('objectPathProblem — injection shapes are rejected', () => {
  const rejected: Array<[string, string]> = [
    ['../../etc/passwd', 'parent traversal'],
    ['images/../../../secret.webp', 'traversal in the middle'],
    ['images/en/../../../..', 'traversal at the end'],
    ['..', 'bare parent'],
    ['.', 'bare dot is not a leading alphanumeric'],
    ['/images/en/sv/1.low.webp', 'absolute'],
    ['images/en/sv/1.low.webp/', 'trailing separator'],
    ['images//en/sv/1.low.webp', 'empty segment'],
    ['images\\en\\sv\\1.low.webp', 'backslash'],
    ['images/en/sv/1.low.webp?download=1', 'query smuggled onto the key'],
    ['images/en/sv/1.low.webp#frag', 'fragment'],
    // encodeURI() leaves '%' alone, so Storage would decode this back to '..'.
    ['images/%2e%2e/%2e%2e/secret', 'percent-escaped traversal'],
    ['images/en/sv/1%2elow.webp', 'percent-escape anywhere'],
    ['images/en/\0/1.low.webp', 'NUL byte'],
    ['images/en/sv/1.low.webp\0.png', 'NUL truncation'],
    ['images/en/sv /1.low.webp', 'space in a segment'],
    ['images/en/sv/.hidden', 'segment starting with a dot'],
    ['-images/en', 'segment starting with a hyphen'],
    ['', 'empty'],
    // A different bucket, or Storage's own admin routes, one level up.
    ['../avatars/someone.webp', 'escape into another bucket'],
  ];

  for (const [key, why] of rejected) {
    it(`rejects ${JSON.stringify(key)} (${why})`, () => {
      assert.notEqual(objectPathProblem(key), null);
      assert.equal(isSafeObjectPath(key), false);
    });
  }

  it('rejects a key longer than the cap', () => {
    const long = `images/${'a'.repeat(MAX_OBJECT_PATH_LENGTH)}`;
    assert.match(String(objectPathProblem(long)), /longer than/);
  });

  it('rejects non-strings rather than coercing them', () => {
    for (const v of [null, undefined, 42, {}, ['images']]) {
      assert.notEqual(objectPathProblem(v), null, String(v));
    }
  });
});

describe('assertSafeObjectPath', () => {
  it('throws — a bad key must never be mistaken for a cache miss', () => {
    assert.throws(() => assertSafeObjectPath('../../secret', 'uploadObject'), /uploadObject/);
    assert.throws(() => assertSafeObjectPath('../../secret', 'uploadObject'), /unsafe object key/);
  });

  it('names the problem and echoes the key, truncated', () => {
    assert.throws(() => assertSafeObjectPath('a?b', 'objectExists'), /query separator/);
    assert.throws(() => assertSafeObjectPath(`x${'!'.repeat(500)}`, 'moveObject(source)'), (err) => {
      const message = (err as Error).message;
      assert.ok(message.includes('moveObject(source)'));
      assert.ok(message.length < 400, 'the echoed key must be truncated');
      return true;
    });
  });

  it('is a no-op for a real key', () => {
    assert.doesNotThrow(() =>
      assertSafeObjectPath(
        cardRelativePath({ serie: 'sv', set: 'sv03.5', localId: '102' }, 'low'),
        'uploadObject',
      ),
    );
  });
});

describe('the storage ORIGIN, not just the path', () => {
// ── The ORIGIN half of the choke point ───────────────────────────────────────
//
// `assertSafeObjectPath` guards the path. It cannot guard the host, and the
// host was the half CodeQL's taint tracker was following: the request used to
// be built as `${supabaseUrl}/storage/v1/...` with `supabaseUrl` straight out
// of `process.env`. #37/#39/#60 stayed open on `main` after the path guard
// shipped, for exactly that reason.

  it('storageOrigin keeps only the origin, dropping any configured path', () => {
  // A trailing path on SUPABASE_URL used to be spliced in front of every object
  // key, silently, on every request.
  assert.equal(storageOrigin('https://proj.supabase.co').origin, 'https://proj.supabase.co')
  assert.equal(storageOrigin('https://proj.supabase.co/some/prefix').origin, 'https://proj.supabase.co')
  assert.equal(storageOrigin('https://proj.supabase.co/?a=1#f').origin, 'https://proj.supabase.co')
  })

  it('storageOrigin refuses plaintext, because the service-role key rides along', () => {
  assert.throws(() => storageOrigin('http://proj.supabase.co'), /must be https/)
  assert.throws(() => storageOrigin('ftp://proj.supabase.co'), /must be https/)
  })

  it('storageOrigin refuses a value that is not a URL at all', () => {
  for (const bad of ['', 'proj.supabase.co', 'not a url', '/relative']) {
    assert.throws(() => storageOrigin(bad), /not a URL|no host/, `accepted ${JSON.stringify(bad)}`)
  }
  })

  it('storageUrl composes against the origin — a path cannot escape it', () => {
  const base = 'https://proj.supabase.co'
  assert.equal(
    storageUrl(base, 'storage/v1/object/public/card-art/a/b.webp').href,
    'https://proj.supabase.co/storage/v1/object/public/card-art/a/b.webp',
  )
  // Leading slashes are normalised rather than producing a protocol-relative
  // URL, which is the classic way a "path" becomes a host.
  assert.equal(storageUrl(base, '/storage/v1/object/move').href, 'https://proj.supabase.co/storage/v1/object/move')
  assert.equal(storageUrl(base, '//evil.example/x').href, 'https://proj.supabase.co/evil.example/x')
  })
});
