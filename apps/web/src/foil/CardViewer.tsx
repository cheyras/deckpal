// foil/CardViewer.tsx — the three.js card viewer.
//
// A single card plane (correct 63×88 aspect, rounded corners via shader
// alpha) with the assembled foil ShaderMaterial. The rAF loop eases current
// tilt toward `tiltTarget` (a mutable ref from useTilt), rotates the card,
// and pushes live uniform values from `settingsRef` — so slider changes and
// pointer/gyro motion never re-render React.

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { FoilPattern } from './patterns'
import { buildFoilMaterial, CARD_ASPECT } from './shader'

export interface ViewerSettings {
  /** Core + pattern uniform values, keyed by uniform name. */
  uniforms: Record<string, number>
  maskRect: [number, number, number, number]
  maskRadius: number
  maskFeather: number
  maskInvert: boolean
  maskView: boolean
  /** Max card rotation in degrees at |tilt| = 1. */
  maxTiltDeg: number
}

export function CardViewer({
  imageUrl,
  pattern,
  settingsRef,
  tiltTarget,
  onPointerMove,
  onPointerLeave,
  className = '',
}: {
  imageUrl: string | null
  pattern: FoilPattern
  settingsRef: React.RefObject<ViewerSettings>
  tiltTarget: React.RefObject<{ x: number; y: number }>
  onPointerMove?: (e: React.PointerEvent<HTMLElement>) => void
  onPointerLeave?: () => void
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const textureRef = useRef<THREE.Texture | null>(null)

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

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20)
    camera.position.z = 3.1

    // Card plane: width 1, height = aspect. Segments allow future curvature.
    const geo = new THREE.PlaneGeometry(1, CARD_ASPECT, 12, 16)
    const mesh = new THREE.Mesh(geo)
    meshRef.current = mesh
    scene.add(mesh)

    const fit = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
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
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      geo.dispose()
      materialRef.current?.dispose()
      textureRef.current?.dispose()
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
    mesh.material = mat
    materialRef.current = mat
    old?.dispose()
  }, [pattern])

  // Image change → load texture.
  useEffect(() => {
    if (!imageUrl) return
    let cancelled = false
    new THREE.TextureLoader().load(imageUrl, (tex) => {
      if (cancelled) {
        tex.dispose()
        return
      }
      tex.colorSpace = THREE.SRGBColorSpace
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
      ref={hostRef}
      className={className}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    />
  )
}
