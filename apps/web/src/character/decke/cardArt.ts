/**
 * Real card art on the cards he handles.
 *
 * Every card in the glb is textured with AI-generated placeholder art baked
 * into the asset — "BLOBULON, 70 HP". That was right while the character was
 * being built and is wrong the moment he is put in front of a user, because the
 * whole point of the stash flight is "this is his way of showing the ACTUAL
 * cards they added going down into the deck box". A card that is not the card
 * they added is a decoration; a card that is theirs is the feature.
 *
 * THREE FACTS ABOUT THE ASSET, each of which shapes this file.
 *
 * 1. THE FRONT MATERIALS ARE SHARED. `Card_Front_Rose3` is one material used by
 *    `Card_Loose_Rose_anim` AND all five `Stash_Card_*` meshes, and the stash
 *    pool CLONES those meshes for batches past five — three clones share
 *    materials by reference, so a clone shares it too. Assigning a texture to
 *    the material as it comes out of the loader therefore sets it on every card
 *    at once, which is the one thing this feature must not do. So each card node
 *    gets its OWN material, cloned at bind time, before anything is assigned.
 *
 * 2. THE UNWRAP IS A CLEAN 0..1 AND THE V AXIS IS glTF's. Both faces of every
 *    card map the full image across the full face (verified by reading the
 *    decoded attribute, not the accessor bounds — the mesh is meshopt-compressed
 *    and the raw bytes are not floats). glTF's V axis points the other way from
 *    the browser's, which the loader handles by setting `flipY = false` on every
 *    texture it makes. A texture WE make defaults to `flipY = true`, so a card
 *    loaded the obvious way comes out upside down. See `LOAD`.
 *
 * 3. `materials.ts` REWRITES THE FRONTS. Their exported emissive is a white 1.0
 *    that washes the artwork out completely, so the fixup tints the glow by the
 *    ARTWORK — `emissiveMap = map` — and turns on thin-film iridescence for the
 *    foil. That binding is by reference to the texture that was there at load,
 *    so swapping `map` alone leaves the card glowing in the shape of the
 *    placeholder it no longer shows. `emissiveMap` moves with `map`, always.
 *
 * WHAT THIS MODULE IS NOT. It does not know what a Pokemon is, where the catalog
 * lives, or how to ask for a card. It takes URLs, and `cardSource.ts` is what
 * turns "the cards this user just added" into them — this is the part that would
 * survive the product changing its mind about where card images come from.
 *
 * With ONE honest exception, and pretending otherwise would be worse than the
 * exception: `marked()` below knows that this app's images come back through a
 * redirect, and that is product knowledge sitting in a module whose header would
 * rather it did not. It is here because it is a property of LOADING a texture in
 * this deployment rather than of choosing one, and because a caller who forgot to
 * apply it would get a failure that reproduces on cloud only, weeks later. If
 * this module is ever lifted somewhere else, that constant is the thing to
 * question first.
 */
import {
  SRGBColorSpace,
  TextureLoader,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three'

/**
 * One card's artwork.
 *
 * TWO SIZES, BECAUSE THE COST IS NOT THE SAME AT BOTH ENDS. The catalog serves
 * cards at 245x337 and 600x825 and nothing above (see `packages/storage`'s path
 * algebra). A dozen stash cards at the large size is ~32 MB of GPU memory for
 * cards drawn 150 px tall; the same dozen small is ~5 MB. But the single card he
 * holds up in `card_present` fills a third of the screen, and at the small size
 * its type line is mush. So the slot picks, and the caller supplies both.
 */
export type CardArt = {
  /** Stable identity, for logging and for "is this already the art in this
   *  slot". The catalog's card id where there is one; anything unique otherwise. */
  id: string
  /** The small front image. Required — it is the one every slot can fall back to. */
  front: string
  /** The large front image, for the slots drawn big. Falls back to `front`. */
  frontLarge?: string
  /** For diagnostics only. Nothing renders it. */
  name?: string
}

/**
 * The card faces that can carry art, named for the CHANNEL that drives them
 * rather than for the mesh.
 *
 * `card_l`/`card_r` are HIS left and right, like every other L/R in this
 * character — the two cards that orbit during `loading`, of which `card_r` is
 * also the one he holds up in `card_present` and `travel_point`. `single` is the
 * card inside him. `deck` is the top of the stack in the box, which is the face
 * that updates as stashed cards land on it.
 */
export type CardSlot = 'card_l' | 'card_r' | 'single' | 'deck'

/**
 * The card back, relative to the app's base URL.
 *
 * The one asset in this character that is not ours: the Pokemon TCG back, which
 * a collection app showing a user's cards going into a deck box has to show,
 * because it is the back those cards actually have. Provenance and how to
 * regenerate it are in `models/decke/CREDITS.md`.
 *
 * It lives beside the glb rather than in the image service because it is a fixed
 * graphic, not a per-card image — there is nothing to key it on, nothing to warm
 * and nothing to invalidate, and `models/**` is already outside the PWA precache
 * so it costs nobody but the people who open the route.
 */
export const CARD_BACK_URL = 'models/decke/card_back.webp'

/**
 * Which slots are drawn large enough to want the large image.
 *
 * Only one is. `card_r` is the card he HOLDS UP in `card_present`, where it
 * fills a third of the screen and its type line has to be readable; at the small
 * size that text is mush. Everything else is drawn at roughly a card's authored
 * size relative to him — measured about 125 CSS px wide with him at his default
 * 300 px height — which the 245 px image covers with room over.
 *
 * The difference is 2.6 MB of GPU memory per slot against 0.44 MB, so this is
 * not a rounding error on a phone. `deck` in particular would be the wrong call
 * twice over: the stash flight rewrites it from the batch's own art, which was
 * loaded small, so asking for large here would fetch a second copy of an image
 * that is about to be replaced by the small one anyway.
 */
const WANTS_LARGE: Record<CardSlot, boolean> = {
  card_l: false,
  card_r: true,
  single: false,
  deck: false,
}

/** The node each slot lives under. The FRONT is that node's first mesh child —
 *  the glb's three primitives (front, back, edge) become three meshes, in that
 *  order, and `bindFace` asserts the material name rather than trusting it. */
const SLOT_NODE: Record<CardSlot, string> = {
  card_l: 'Card_Loose_Rose_anim',
  card_r: 'Card_Loose_Amber_anim',
  single: 'Card_Single_anim',
  deck: 'Card_Deck_anim',
}

/**
 * A marker query parameter, and the reason it is not superstition.
 *
 * Card images are requested from the same-origin path `/deckpal/images/...`,
 * which on the cloud tier 302-REDIRECTS to Supabase Storage on another origin.
 * A plain `<img src>` with no `crossOrigin` (which is exactly what
 * `CardImage.tsx` renders, all over the app) fetches that in no-cors mode and
 * leaves an OPAQUE entry in the HTTP cache — and the service worker caches these
 * with `statuses: [0, 200]`, so it keeps opaque ones too. WebGL cannot upload an
 * image that is not origin-clean; it throws rather than drawing something wrong.
 *
 * So a texture fetch of a URL the card grid has already rendered can fail for
 * reasons that have nothing to do with the network, and it fails only on cloud,
 * only after the user has scrolled past that card, and never in dev. This is the
 * same trap `DECISIONS.md` records for the bug reporter's screenshots
 * (2026-08-10) and it takes the same fix: request a URL that is ours alone. Both
 * image tiers ignore unknown query parameters — the cloud handler routes on
 * `p=`, the self-host server on the Express path — so this changes which cache
 * entry is used and nothing else.
 *
 * The cost is honest and small: cards Deck-E shows are cached twice.
 *
 * Exported for `__tests__/cardArt.test.ts`: this is the one piece of the trap
 * that can be checked without a GPU, and getting it wrong fails only on cloud,
 * only for a card the reader has already scrolled past.
 */
const TEXTURE_MARK = 'decke'

export function marked(url: string): string {
  // Textual, not `new URL`, so a relative URL stays relative — resolving it
  // against the document would bake the current origin into the cache key and
  // make the same card two entries on two pages. A `data:` or `blob:` URL is a
  // caller doing something reasonable and is passed through untouched.
  if (!/^(https?:)?\/\//.test(url) && !url.startsWith('/')) return url
  if (new RegExp(`[?&]${TEXTURE_MARK}=`).test(url)) return url
  const hash = url.indexOf('#')
  const base = hash < 0 ? url : url.slice(0, hash)
  const frag = hash < 0 ? '' : url.slice(hash)
  return `${base}${base.includes('?') ? '&' : '?'}${TEXTURE_MARK}=1${frag}`
}

/**
 * How many card textures to keep alive at once.
 *
 * A stash run can name far more cards than fit on screen — that is the whole
 * point of batching — and every one of them is a texture upload. Holding them
 * all is how a 48-card stash becomes an out-of-memory context loss on a phone.
 * Twenty-four is two full batches of twelve, so the batch that is hanging and
 * the batch being preloaded behind it both fit exactly, and anything older is a
 * card the reader has already watched go in.
 *
 * A COUNT and not a byte budget, which is only defensible because the mix is
 * bounded: `WANTS_LARGE` names exactly one slot, so at most a couple of these
 * entries are ever the 600x825 image and the rest are 245x337. Twenty-four works
 * out around 13 MB. If a second slot ever asks for the large image — and `deck`
 * did, briefly, which is how this note got written — that arithmetic stops
 * holding and this wants to count bytes instead.
 */
const CACHE_LIMIT = 24

type Entry = { url: string; tex: Texture | null; promise: Promise<Texture | null>; used: number }

export type CardArtSystem = {
  /** Put art in a slot. `null` restores the placeholder baked into the glb. */
  set(slot: CardSlot, art: CardArt | null): void
  /** What is in a slot now, by id. Empty string for the placeholder. */
  idAt(slot: CardSlot): string
  /**
   * Art for a batch, given the pool nodes it will actually use.
   *
   * THE NODES ARE PASSED, not looked up by index. Both this module and
   * `cards.ts` build a list of the same pool in what should be the same order —
   * one from a scene traversal, one from `cards.json` — and "should be" is the
   * whole problem: if those two orders ever disagreed, every card would get its
   * neighbour's art and it would look like a texture bug rather than an
   * ordering one. Handing over the nodes removes the second ordering.
   */
  setStash(nodes: Object3D[], arts: (CardArt | null)[]): void
  /**
   * Adopt a stash node the pool created after load.
   *
   * `cards.ts` clones a mesh when a batch is bigger than the five the glb ships,
   * and a clone arrives sharing its source's material — including, if the source
   * has already been given a card, that card's texture. So a clone must be given
   * its own material before it is drawn, and this is the only moment that can
   * happen.
   */
  adoptStash(node: Object3D): void
  /** Warm the cache so a card is not still loading when its pop starts. Resolves
   *  when every one of them has settled, failures included. */
  preload(arts: (CardArt | null | undefined)[], large?: boolean): Promise<void>
  /** Swap the card BACK on every card at once. `null` restores the baked back. */
  setBack(url: string | null): void
  /** Release every texture this system made. The baked ones belong to the glb
   *  and are disposed with it. */
  dispose(): void
}

type Face = {
  mat: MeshStandardMaterial
  /**
   * The material the glb shipped, which cloning ORPHANED.
   *
   * `DeckE.dispose` frees materials by walking the scene, and after `bindFace`
   * no mesh points at this one any more — so without a reference here it is the
   * one thing in the model the teardown cannot reach. React 19's StrictMode
   * mounts effects twice in dev, so a leak here is paid on every hot reload.
   */
  original: Material
  /** The texture the glb shipped. Never disposed here, and the thing `null`
   *  restores. */
  placeholder: Texture | null
  /** Whether `materials.ts` tied the emissive to the artwork on this material.
   *  Only the fronts, and only the ones whose export was the broken white. */
  foil: boolean
  /** Whose art is on it. `''` is the placeholder. */
  id: string
  /** Which load is the live one. A slot re-assigned while a texture is in flight
   *  must not be overwritten when the stale load lands. */
  token: number
}

/**
 * Find a card node's front (or back) material and make it this card's own.
 *
 * ASSERTS THE MATERIAL NAME rather than trusting child order. The glTF loader
 * turns a three-primitive mesh into three sibling meshes and has always emitted
 * them in the source order (front, back, edge), but "has always" is not a
 * contract, and getting this wrong would put a Charizard on the card's EDGE — a
 * 96-vertex strip with degenerate UVs — and leave the face showing a
 * placeholder, which reads as "the art system silently does nothing".
 */
function bindFace(node: Object3D, prefix: 'Card_Front_' | 'Card_Back_'): Face | null {
  let found: Face | null = null
  node.traverse((o) => {
    if (found) return
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const mats: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const i = mats.findIndex((m) => (m?.name ?? '').startsWith(prefix))
    if (i < 0) return
    const std = mats[i].clone() as MeshStandardMaterial
    if (Array.isArray(mesh.material)) mesh.material[i] = std
    else mesh.material = std
    found = {
      mat: std,
      original: mats[i],
      placeholder: std.map ?? null,
      // `materials.ts` sets `emissiveMap = map` on exactly the fronts it fixed
      // up. Reading the result is more honest than re-deriving the condition.
      foil: !!std.emissiveMap && std.emissiveMap === std.map,
      id: '',
      token: 0,
    }
  })
  return found
}

export function createCardArt(
  root: Object3D,
  opts: { maxAnisotropy?: number } = {},
): CardArtSystem {
  const loader = new TextureLoader()
  // Cross-origin because the same-origin path redirects across origins on the
  // cloud tier, and WebGL refuses an image that is not origin-clean.
  loader.setCrossOrigin('anonymous')
  const anisotropy = Math.max(1, Math.min(8, opts.maxAnisotropy ?? 1))

  const cache = new Map<string, Entry>()
  let clock = 0
  let disposed = false

  function load(url: string): Promise<Texture | null> {
    const key = marked(url)
    const hit = cache.get(key)
    if (hit) {
      hit.used = ++clock
      return hit.promise
    }
    const entry: Entry = { url: key, tex: null, promise: Promise.resolve(null), used: ++clock }
    entry.promise = loader
      .loadAsync(key)
      .then((tex) => {
        if (disposed) {
          tex.dispose()
          return null
        }
        // glTF's V axis, not the browser's. Without this every card is upside
        // down — and upside down on a card is not subtly wrong, it is the one
        // thing anyone looking at the screen will see first. See the header.
        tex.flipY = false
        tex.colorSpace = SRGBColorSpace
        tex.anisotropy = anisotropy
        tex.needsUpdate = true
        entry.tex = tex
        return tex
      })
      .catch((err) => {
        // A card that will not load shows the placeholder. Never a blank slab:
        // existence is scale in this character, so an "empty" card is a card
        // that is there, catching the environment, showing nothing.
        console.warn(`decke card art: ${key} failed to load`, err)
        cache.delete(key)
        return null
      })
    cache.set(key, entry)
    evict()
    return entry.promise
  }

  /**
   * Least-recently-used, over ONE pass of the settled entries.
   *
   * A pass, and not a `while (cache.size > CACHE_LIMIT)` loop, because the loop
   * has no bound: if every settled texture is on a visible card there is nothing
   * it may free, and re-picking the least-recently-used one forever is a hung
   * tab rather than a dropped frame. Today that cannot happen — eighteen faces
   * against a limit of twenty-four — but "cannot happen" there is an arithmetic
   * relationship between two constants in different files, which is exactly the
   * kind of thing that stops being true.
   *
   * Never one still in flight, either: disposing a texture whose load has not
   * settled leaks the upload instead of freeing it. Going over the limit is the
   * correct outcome when nothing is free; freeing a texture out from under a
   * card the reader is looking at is not.
   */
  function evict() {
    if (cache.size <= CACHE_LIMIT) return
    const settled = [...cache.values()].filter((e) => e.tex).sort((a, b) => a.used - b.used)
    for (const e of settled) {
      if (cache.size <= CACHE_LIMIT) return
      if (inUse(e.tex)) continue
      e.tex?.dispose()
      cache.delete(e.url)
    }
  }

  function inUse(tex: Texture | null): boolean {
    if (!tex) return false
    for (const f of faces()) if (f.mat.map === tex) return true
    return false
  }

  // ---- the faces --------------------------------------------------------
  const slots = new Map<CardSlot, Face>()
  for (const [slot, name] of Object.entries(SLOT_NODE) as [CardSlot, string][]) {
    const node = root.getObjectByName(name)
    const face = node ? bindFace(node, 'Card_Front_') : null
    if (face) slots.set(slot, face)
    else console.warn(`decke card art: no front face under "${name}"`)
  }

  /** Keyed by node, so a pool node adopted twice is not re-cloned — which would
   *  drop the art already on it and leak a material. */
  const stash = new Map<Object3D, Face>()
  const backs: Face[] = []
  root.traverse((o) => {
    if (!o.name.startsWith('Stash_Card_')) return
    if (o.parent && o.parent.name.startsWith('Stash_Card_')) return
    const face = bindFace(o, 'Card_Front_')
    if (face) stash.set(o, face)
    // Not fatal — `setStash` is given the nodes and skips the ones it cannot
    // bind, so the rest still get the right art — but it means a card in the fan
    // will show placeholder art forever, and silence about that is how it stays
    // unexplained.
    else console.warn(`decke card art: no front face under "${o.name}"`)
  })
  /** The glb's own stash art, captured before anything can have been assigned.
   *  A pool node cloned later inherits its source's CURRENT material, so this is
   *  the only record of what its placeholder should be. */
  const stashPlaceholder = [...stash.values()][0]?.placeholder ?? null

  function faces(): Face[] {
    return [...slots.values(), ...stash.values(), ...backs]
  }

  function assign(face: Face, url: string | null, id: string) {
    const token = ++face.token
    face.id = id
    if (!url) {
      apply(face, face.placeholder)
      return
    }
    // A disposed system must not start network work. React 19's StrictMode
    // mounts effects twice in dev, so `applyDefaultCards` routinely resolves
    // after the instance it was called for is gone.
    if (disposed) return
    // Synchronously show whatever is already decoded for this URL, so a card
    // whose art is warm never flashes the placeholder on the way in. Touching
    // the entry is not bookkeeping: eviction picks the least recently used, and
    // a texture that is about to go on a card must not be the candidate.
    const hit = cache.get(marked(url))
    if (hit?.tex) {
      hit.used = ++clock
      apply(face, hit.tex)
      return
    }
    void load(url).then((tex) => {
      // Stale: the slot was reassigned while this was in flight.
      if (face.token !== token || disposed) return
      // AND THE ID FOLLOWS THE PIXELS. `face.id` is set optimistically above so
      // that a second assignment can see what the first asked for, but if the
      // load failed the slot is showing the placeholder — and `idAt` promises
      // that `''` means exactly that. Leaving the id set makes this module lie
      // to the one caller who cannot look at the screen: the agent asks which
      // card is up, is told the card that 404'd, and narrates it.
      if (!tex) face.id = ''
      apply(face, tex ?? face.placeholder)
    })
  }

  function apply(face: Face, tex: Texture | null) {
    face.mat.map = tex
    // The foil glow is tinted BY THE ARTWORK. Leaving `emissiveMap` on the old
    // texture makes the card glow in the shape of a card it is not showing.
    if (face.foil) face.mat.emissiveMap = tex
    face.mat.needsUpdate = true
  }

  function urlFor(art: CardArt, large: boolean): string {
    return large ? (art.frontLarge ?? art.front) : art.front
  }

  return {
    set(slot, art) {
      const face = slots.get(slot)
      if (!face) return
      assign(face, art ? urlFor(art, WANTS_LARGE[slot]) : null, art?.id ?? '')
    },

    idAt(slot) {
      return slots.get(slot)?.id ?? ''
    },

    setStash(nodes, arts) {
      nodes.forEach((node, i) => {
        const face = stash.get(node)
        if (!face) return
        const art = arts[i] ?? null
        assign(face, art ? urlFor(art, false) : null, art?.id ?? '')
      })
    },

    adoptStash(node) {
      if (stash.has(node)) return
      const face = bindFace(node, 'Card_Front_')
      if (!face) return
      // A clone arrives sharing its source's material, so its `placeholder` is
      // whatever the source is showing RIGHT NOW — which may be a card. The
      // placeholder has to be the glb's own art, captured before anything was
      // assigned to anything.
      if (stashPlaceholder) face.placeholder = stashPlaceholder
      apply(face, face.placeholder)
      stash.set(node, face)
    },

    async preload(arts, large = false) {
      if (disposed) return
      await Promise.all(
        arts.map((a) => (a ? load(urlFor(a, large)) : Promise.resolve(null))),
      )
    },

    setBack(url) {
      // ONE CLONE PER DISTINCT BACK MATERIAL, not one per card. Every card shows
      // the SAME back — that is what a card back is — so the sharing the glb
      // already has is correct here, and the only reason to clone at all is to
      // avoid writing to a material the loader might hand to something else.
      // Bound lazily: a deployment that never swaps the back never pays for it.
      if (!backs.length) {
        const clones = new Map<string, MeshStandardMaterial>()
        root.traverse((o) => {
          const mesh = o as Mesh
          if (!mesh.isMesh) return
          const mats: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach((m, i) => {
            const name = m?.name ?? ''
            if (!name.startsWith('Card_Back_')) return
            let std = clones.get(name)
            if (!std) {
              std = m.clone() as MeshStandardMaterial
              clones.set(name, std)
              backs.push({
                mat: std,
                original: m,
                placeholder: std.map ?? null,
                foil: !!std.emissiveMap && std.emissiveMap === std.map,
                id: '',
                token: 0,
              })
            }
            if (Array.isArray(mesh.material)) mesh.material[i] = std
            else mesh.material = std
          })
        })
      }
      for (const f of backs) assign(f, url, url ?? '')
    },

    dispose() {
      disposed = true
      for (const e of cache.values()) e.tex?.dispose()
      cache.clear()
      // Both the clone and the material it displaced. The clone is ours; the
      // original is nobody's, because no mesh references it any more and the
      // scene walk in `DeckE.dispose` can only free what it can reach. The
      // textures are not ours either way — the cache's are freed above and the
      // glb's belong to the glb.
      const mats = new Set<Material>()
      for (const f of faces()) {
        mats.add(f.mat)
        mats.add(f.original)
      }
      for (const m of mats) m.dispose()
      slots.clear()
      stash.clear()
      backs.length = 0
    },
  }
}
