// foil/CardViewer.tsx — the three.js card viewer.
//
// A single card plane (correct 63×88 aspect, rounded corners via shader
// alpha) with the assembled foil ShaderMaterial. The rAF loop eases current
// tilt toward `tiltTarget` (a mutable ref from useTilt), rotates the card,
// and pushes live uniform values from `settingsRef` — so slider changes and
// pointer/gyro motion never re-render React.

import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { FoilPattern } from './patterns'
import { buildFoilMaterial, CARD_ASPECT, transparentTexture } from './shader'
import { buildGlyphAtlas, fetchGlyphIndex, glyphSlotFor, resolveGlyphDir } from './glyphs'
import type { ViewController } from './ViewTransform'

export interface ViewerSettings {
  /** Core + pattern uniform values, keyed by uniform name. */
  uniforms: Record<string, number>
  maskRect: [number, number, number, number]
  maskRadius: number
  maskFeather: number
  maskInvert: boolean
  maskView: boolean
  /** Hand-mask tier: sample the mask canvas instead of the layout rect. */
  maskTexOn: boolean
  /** Bump to signal the mask canvas contents changed (stroke finished). */
  maskTexVersion: number
  /** Max card rotation in degrees at |tilt| = 1. */
  maxTiltDeg: number
  /**
   * R4b: is uFace a REAL CARD SCAN (true/undefined — the scan-additive
   * composite applies) or a synthetic blank base (false — the canon lab's
   * pattern room, classic composite, bit-identical canon renders)?
   */
  scanBase?: boolean
}

export function CardViewer({
  imageUrl,
  pattern,
  settingsRef,
  tiltTarget,
  maskCanvas,
  view,
  onPointerMove,
  onPointerLeave,
  className = '',
  children,
}: {
  imageUrl: string | null
  pattern: FoilPattern
  settingsRef: React.RefObject<ViewerSettings>
  tiltTarget: React.RefObject<{ x: number; y: number }>
  /** Hand-mask drawing surface (alpha = coverage); null when layout tier active. */
  maskCanvas?: HTMLCanvasElement | null
  /** Pan/zoom while editing — drives camera.setViewOffset and the overlay wrapper. */
  view?: ViewController
  onPointerMove?: (e: React.PointerEvent<HTMLElement>) => void
  onPointerLeave?: () => void
  className?: string
  /** Overlays (e.g. the mask editor), rendered above the canvas. */
  children?: React.ReactNode
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const textureRef = useRef<THREE.Texture | null>(null)
  const maskTexRef = useRef<THREE.CanvasTexture | null>(null)
  const maskVersionSeen = useRef(-1)
  // Glyph slot (R3-GLYPH): rasterized atlas of Chey's real glyph artwork.
  const glyphTexRef = useRef<THREE.CanvasTexture | null>(null)
  const glyphInfoRef = useRef<{ count: number; cols: number } | null>(null)
  // The controller is stable, but keep it in a ref so the once-only scene
  // effect never closes over a stale value.
  const viewCtlRef = useRef<ViewController | undefined>(view)
  viewCtlRef.current = view

  // Merged ref: the scene effect needs the host, the gesture controller needs
  // the same element (its client box IS the three.js viewport).
  const setHost = useCallback(
    (el: HTMLDivElement | null) => {
      hostRef.current = el
      view?.hostRef(el)
    },
    [view],
  )

  const applyGlyphUniforms = (mat: THREE.ShaderMaterial) => {
    if (!mat.uniforms.uGlyphTex) return
    const info = glyphInfoRef.current
    mat.uniforms.uGlyphTex.value = glyphTexRef.current ?? transparentTexture()
    mat.uniforms.uGlyphOn.value = info ? 1 : 0
    mat.uniforms.uGlyphCount.value = info?.count ?? 0
    mat.uniforms.uGlyphCols.value = info?.cols ?? 1
  }

  // Scene lifecycle — once.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'
    // Fix 2 (Chey, 2026-08-08 — "sometimes the card image gets 'selected' when
    // I'm trying to draw"): a paint gesture must never start a selection, a
    // drag ghost, or iOS's long-press callout on the rendered card.
    renderer.domElement.style.userSelect = 'none'
    renderer.domElement.style.setProperty('-webkit-user-select', 'none')
    renderer.domElement.style.setProperty('-webkit-touch-callout', 'none')
    renderer.domElement.style.setProperty('-webkit-user-drag', 'none')
    renderer.domElement.draggable = false

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20)
    camera.position.z = 3.1

    // Card plane: width 1, height = aspect. Segments allow future curvature.
    const geo = new THREE.PlaneGeometry(1, CARD_ASPECT, 12, 16)
    const mesh = new THREE.Mesh(geo)
    meshRef.current = mesh
    scene.add(mesh)

    // Host box in CSS px — the denominator for the zoom view offset.
    const size = { w: 0, h: 0 }
    let viewKey = ''
    const fit = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      size.w = w
      size.h = h
      viewKey = '' // force the view offset to be reapplied at the new size
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      // Fit the card into view with margin for rotation.
      const fovY = (camera.fov * Math.PI) / 180
      const distH = (CARD_ASPECT / 2 / Math.tan(fovY / 2)) * 1.16
      const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect)
      const distW = (0.5 / Math.tan(fovX / 2)) * 1.16
      camera.position.z = Math.max(distH, distW)
      camera.updateProjectionMatrix()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(host)

    const tilt = { x: 0, y: 0 }
    let raf = 0
    const start = performance.now()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const s = settingsRef.current
      const mat = materialRef.current
      if (!mat || !s) return
      // Pan/zoom: render the (x,y,w,h) window out of a virtual w·z × h·z image.
      // Re-rasterizing at the zoomed size is what makes 4× zoom show 4× real
      // detail — the whole point of the feature for edge tracing.
      const vt = viewCtlRef.current?.view.current
      const z = vt ? vt.zoom : 1
      const vx = vt ? vt.x : 0
      const vy = vt ? vt.y : 0
      const key = `${z}|${vx}|${vy}|${size.w}|${size.h}`
      if (key !== viewKey) {
        viewKey = key
        if (z !== 1 && size.w > 0) camera.setViewOffset(size.w * z, size.h * z, vx, vy, size.w, size.h)
        else camera.clearViewOffset()
      }
      const tgt = tiltTarget.current ?? { x: 0, y: 0 }
      tilt.x += (tgt.x - tilt.x) * 0.12
      tilt.y += (tgt.y - tilt.y) * 0.12
      const mesh0 = meshRef.current
      if (mesh0) {
        const maxRad = (s.maxTiltDeg * Math.PI) / 180
        mesh0.rotation.y = tilt.x * maxRad
        mesh0.rotation.x = -tilt.y * maxRad
      }
      const u = mat.uniforms
      ;(u.uTilt.value as THREE.Vector2).set(tilt.x, tilt.y)
      u.uTime.value = (performance.now() - start) / 1000
      for (const [k, v] of Object.entries(s.uniforms)) {
        if (u[k]) u[k].value = v
      }
      ;(u.uMaskRect.value as THREE.Vector4).set(...s.maskRect)
      u.uMaskRadius.value = s.maskRadius
      u.uMaskFeather.value = s.maskFeather
      u.uMaskInvert.value = s.maskInvert ? 1 : 0
      u.uMaskView.value = s.maskView ? 1 : 0
      if (u.uScanBase) u.uScanBase.value = s.scanBase === false ? 0 : 1
      u.uMaskTexOn.value = s.maskTexOn && maskTexRef.current ? 1 : 0
      if (maskTexRef.current && s.maskTexVersion !== maskVersionSeen.current) {
        maskTexRef.current.needsUpdate = true
        maskVersionSeen.current = s.maskTexVersion
      }
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      geo.dispose()
      materialRef.current?.dispose()
      textureRef.current?.dispose()
      glyphTexRef.current?.dispose()
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pattern change → rebuild the material (new fragment shader).
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const old = materialRef.current
    const mat = buildFoilMaterial(pattern)
    if (textureRef.current) mat.uniforms.uFace.value = textureRef.current
    if (maskTexRef.current) mat.uniforms.uMaskTex.value = maskTexRef.current
    applyGlyphUniforms(mat)
    mesh.material = mat
    materialRef.current = mat
    old?.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern])

  // Glyph slot (R3-GLYPH): while a glyph-capable pattern is displayed, poll
  // the dev api's glyph index and (re)rasterize Chey's dropped artwork into
  // the atlas texture — saving a file into research/foil-glyphs/<slug>/ IS
  // the deploy. No dev api (prod) → the first fetch returns null and the poll
  // stops; recipes keep their procedural fallback (uGlyphOn 0).
  useEffect(() => {
    glyphTexRef.current?.dispose()
    glyphTexRef.current = null
    glyphInfoRef.current = null
    if (materialRef.current) applyGlyphUniforms(materialRef.current)
    const slug = glyphSlotFor(pattern.id)
    if (!slug) return
    let cancelled = false
    let timer: number | undefined
    let lastKey = ''
    const tick = async () => {
      const index = await fetchGlyphIndex()
      if (cancelled) return
      if (index === null) return // dev surface absent — stop polling this mount
      const dir = resolveGlyphDir(index, slug)
      const key = dir ? `${dir}:${index[dir].mtime}:${index[dir].files.join(',')}` : ''
      if (key !== lastKey) {
        const atlas = dir ? await buildGlyphAtlas(dir, index[dir]) : null
        if (cancelled) return
        lastKey = key
        glyphTexRef.current?.dispose()
        if (atlas) {
          const tex = new THREE.CanvasTexture(atlas.canvas)
          // Same convention as the hand-mask: exactly one flip, in the shader
          // (glyphTex maps y-up glyph space to the y-down canvas). LinearFilter
          // (no mips): mip levels would bleed across atlas cells.
          tex.flipY = false
          tex.minFilter = THREE.LinearFilter
          tex.magFilter = THREE.LinearFilter
          glyphTexRef.current = tex
          glyphInfoRef.current = { count: atlas.count, cols: atlas.cols }
        } else {
          glyphTexRef.current = null
          glyphInfoRef.current = null // assets deleted → procedural fallback
        }
        if (materialRef.current) applyGlyphUniforms(materialRef.current)
      }
      timer = window.setTimeout(() => void tick(), 2500)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern])

  // Hand-mask canvas change → (re)create the CanvasTexture.
  useEffect(() => {
    maskTexRef.current?.dispose()
    maskTexRef.current = null
    maskVersionSeen.current = -1
    if (maskCanvas) {
      const tex = new THREE.CanvasTexture(maskCanvas)
      // The shader flips V explicitly (canvas is y-down); disable the GPU-side
      // flip or the two cancel out and the mask renders upside down.
      tex.flipY = false
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      maskTexRef.current = tex
      const mat = materialRef.current
      if (mat) mat.uniforms.uMaskTex.value = tex
    }
  }, [maskCanvas])

  // Image change → load texture.
  useEffect(() => {
    if (!imageUrl) return
    let cancelled = false
    new THREE.TextureLoader().load(imageUrl, (tex) => {
      if (cancelled) {
        tex.dispose()
        return
      }
      // Deliberately NOT SRGBColorSpace: that uploads as SRGB8_ALPHA8 and the
      // hardware decodes to LINEAR at sample time, but our ShaderMaterial
      // writes gl_FragColor raw (three only appends the linear->sRGB
      // colorspace_fragment chunk to built-in materials) — the scan rendered
      // in linear values displayed as sRGB, darkening every midtone (measured
      // flat 184 -> 123, exactly the sRGB->linear curve; issue ls9u0y). The
      // whole foil compositing model (screenBlend, hueRamp, art-gate
      // thresholds) is authored in DISPLAY space, so sample the scan
      // undecoded: pattern=none now matches the flat <img> pixel-for-pixel.
      tex.colorSpace = THREE.NoColorSpace
      tex.anisotropy = 4
      textureRef.current?.dispose()
      textureRef.current = tex
      const mat = materialRef.current
      if (mat) mat.uniforms.uFace.value = tex
    })
    return () => {
      cancelled = true
    }
  }, [imageUrl])

  return (
    <div
      ref={setHost}
      className={`relative overflow-hidden select-none [-webkit-touch-callout:none] ${className}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {/* Overlay wrapper — carries the pan/zoom transform (set imperatively by
          the controller) so the mask/window overlays stay locked to the card. */}
      <div
        ref={view?.wrapRef}
        data-testid="foil-view-wrap"
        className="pointer-events-none absolute inset-0"
        style={{ transformOrigin: '0 0' }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * The on-screen rect (px, relative to the host) that the card face occupies at
 * zero tilt — the exact inverse of `fit()`'s 1.16-margin projection. Used by
 * the mask editor to align its drawing overlay with the rendered card.
 */
export function cardScreenRect(hostW: number, hostH: number): { left: number; top: number; width: number; height: number } {
  // height-limited when the host is wider than the card's aspect; width-limited
  // otherwise — min() covers both, matching fit()'s max(distH, distW).
  const height = Math.min(hostH, hostW * CARD_ASPECT) / 1.16
  const width = height / CARD_ASPECT
  return { left: (hostW - width) / 2, top: (hostH - height) / 2, width, height }
}
