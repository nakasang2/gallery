'use client'
// Bakes each exhibit's REAL wall shadow (frame/wire/plaque silhouette) into a
// small texture, one work per animation frame, using a single roaming bake light.
// Once every work is baked the scene needs NO per-exhibit shadow lights at all —
// only the two bench downlights remain — so the WebGL 16-texture-unit ceiling can
// never be hit again, no matter how many works a layout holds (decision 2026-07-23
// 案C). The soft penumbra is done here at bake time with a wide Poisson PCF, which
// also looks better than the runtime PCF it replaces.
//
// Pipeline per work:
//   frame N   — move the bake light to the work's light rig, castShadow on,
//               shadowMap.needsUpdate (three renders the 2048px depth map)
//   frame N+1 — render the wall patch in UV space, sampling that depth map with
//               a 16-tap PCF, into the work's 256px occlusion texture; light off
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'

export interface BakeSpec {
  id: string
  /** Exhibit group transform (the patch plane lives in this local space) */
  slotX: number
  slotZ: number
  rotY: number
  /** Wall patch (local): width/height and vertical centre offset */
  patchW: number
  patchH: number
  patchOffsetY: number
  /** Light rig (world) — identical to the exhibit's visual spot */
  lightPos: THREE.Vector3
  target: THREE.Vector3
  angle: number
  penumbra: number
  /** Shadow camera near plane — the picture light hangs ~0.3m from its casters,
   *  so the default 0.5 would clip them out of the depth map */
  near: number
  /** PCF blur radius in shadow-map pixels (close light = broad real penumbra) */
  softPx: number
}

const BAKE_SIZE = 256
const SHADOW_MAP_SIZE = 2048

// GLSL3: the shadow map is read through the render target's DEPTH texture with a
// hardware compare sampler (sampler2DShadow) — in three r185 the colour attachment
// of a shadow map holds a Basic-packed 8-bit grayscale that is useless for depth
// comparison; the depth texture (compareFunction=LessEqual) is the real data.
const bakeVert = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// Output = black, alpha = occlusion × the SPOT's own relative irradiance at that
// texel. A real shadow only removes the spotlight's contribution: outside the
// light pool there is nothing to block, so the shadow must fade to zero there.
// Without this ratio the silhouette reads as a uniform dark decal (a full-height
// band peeking around the floated frame — user-reported as "not correct").
const bakeFrag = /* glsl */ `
  precision highp float;
  precision highp sampler2DShadow;
  uniform sampler2DShadow uShadowMap;
  uniform mat4 uShadowMatrix;
  uniform vec3 uOrigin;
  uniform vec3 uAxisU;
  uniform vec3 uAxisV;
  uniform float uBias;
  uniform float uRadius;   // PCF radius in shadow-map UV units
  uniform vec3 uLightPos;  // spot rig (world)
  uniform vec3 uSpotDir;   // normalized light→target
  uniform float uCosOuter; // cos(angle)
  uniform float uCosInner; // cos(angle * (1 - penumbra))
  uniform float uRefDist;  // light→target distance (irradiance normalizer)
  uniform vec3 uWallNormal;
  uniform float uAmbient;  // non-spot light floor, in pool-peak-relative units
  in vec2 vUv;
  out vec4 outColor;

  void main() {
    vec3 world = uOrigin + uAxisU * vUv.x + uAxisV * vUv.y;
    vec4 sc = uShadowMatrix * vec4(world, 1.0);
    vec3 p = sc.xyz / sc.w;
    float vis = 1.0;
    if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0 && p.z < 1.0) {
      float z = p.z - uBias;
      vec2 taps[16] = vec2[16](
        vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725),
        vec2(-0.094184101, -0.92938870), vec2(0.34495938, 0.29387760),
        vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464),
        vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
        vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420),
        vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
        vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590),
        vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790)
      );
      float sum = 0.0;
      // texture() on a compare sampler returns the (hardware-PCF) LessEqual result
      for (int i = 0; i < 16; i++) sum += texture(uShadowMap, vec3(p.xy + taps[i] * uRadius, z));
      vis = sum / 16.0;
    }
    // How much spot light would have hit this texel (cone falloff × incidence ×
    // inverse-square, normalized so ~1 at the artwork). The shadow can only be
    // as strong as the light it blocks: alpha = occlusion × pool / (pool + rest).
    vec3 Lv = world - uLightPos;
    float d = max(length(Lv), 1e-4);
    vec3 Ldir = Lv / d;
    float cone = smoothstep(uCosOuter, uCosInner, dot(Ldir, uSpotDir));
    float ndl = max(dot(-Ldir, uWallNormal), 0.0);
    float pool = cone * ndl * (uRefDist * uRefDist) / (d * d);
    float ratio = pool / (pool + uAmbient);
    outColor = vec4(0.0, 0.0, 0.0, (1.0 - vis) * ratio);
  }
`

export default function WallShadowBaker({
  specs,
  bakeKey,
  onBaked,
}: {
  specs: BakeSpec[]
  /** Composition fingerprint — a change restarts the bake from scratch */
  bakeKey: string
  onBaked: (id: string, tex: THREE.Texture) => void
}) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  // One roaming light, moved to each work's rig in turn. intensity 0 = it never
  // lights the scene; the shadow pass renders its depth map regardless.
  const light = useMemo(() => {
    const l = new THREE.SpotLight(0xffffff, 0)
    l.castShadow = false
    l.decay = 0
    l.penumbra = 0.7
    l.distance = 14 // = shadow camera far (tight bound keeps depth precision high)
    l.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
    l.shadow.camera.near = 0.5
    return l
  }, [])

  const bake = useMemo(() => {
    const scene = new THREE.Scene()
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: bakeVert,
      fragmentShader: bakeFrag,
      uniforms: {
        uShadowMap: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uOrigin: { value: new THREE.Vector3() },
        uAxisU: { value: new THREE.Vector3() },
        uAxisV: { value: new THREE.Vector3() },
        uBias: { value: 0.0025 },
        uRadius: { value: 5.5 / SHADOW_MAP_SIZE },
        uLightPos: { value: new THREE.Vector3() },
        uSpotDir: { value: new THREE.Vector3() },
        uCosOuter: { value: 0 },
        uCosInner: { value: 0 },
        uRefDist: { value: 1 },
        uWallNormal: { value: new THREE.Vector3() },
        uAmbient: { value: 0.35 },
      },
      depthTest: false,
      depthWrite: false,
    })
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    return { scene, mat, camera }
  }, [])

  // Render targets by work id — replaced on re-bake, freed on unmount
  const rts = useRef(new Map<string, THREE.WebGLRenderTarget>())
  useEffect(
    () => () => {
      bake.mat.dispose()
      light.shadow.dispose()
      for (const rt of rts.current.values()) rt.dispose()
      rts.current.clear()
    },
    [bake, light]
  )

  // Bake state machine. `queue` restarts whenever the composition changes.
  const state = useRef<{ key: string; idx: number; stage: 'arm' | 'shoot' }>({
    key: '',
    idx: 0,
    stage: 'arm',
  })

  useFrame(() => {
    const s = state.current
    if (s.key !== bakeKey) {
      s.key = bakeKey
      s.idx = 0
      s.stage = 'arm'
    }
    if (s.idx >= specs.length) return
    if (!gl.shadowMap.enabled) return // low tier: no shadow pipeline, keep fakes
    const spec = specs[s.idx]

    if (s.stage === 'arm') {
      // Aim the roaming light exactly like this work's visual spot; three renders
      // its depth map during this frame's normal render.
      light.position.copy(spec.lightPos)
      light.target.position.copy(spec.target)
      light.target.updateMatrixWorld()
      light.angle = spec.angle
      light.shadow.camera.near = spec.near
      light.shadow.camera.updateProjectionMatrix()
      light.castShadow = true
      gl.shadowMap.needsUpdate = true
      s.stage = 'shoot'
      return
    }

    // 'shoot': the depth map is filled — bake this work's patch, then advance.
    if (!light.shadow.map?.depthTexture) {
      // Shadow pass hasn't run yet (e.g. tab was hidden); try again next frame
      return
    }
    rts.current.get(spec.id)?.dispose()
    const rt = new THREE.WebGLRenderTarget(BAKE_SIZE, BAKE_SIZE, {
      depthBuffer: false,
      stencilBuffer: false,
    })
    rts.current.set(spec.id, rt)
    const u = bake.mat.uniforms
    // The DEPTH attachment (compareFunction=LessEqual): sampled with sampler2DShadow
    u.uShadowMap.value = light.shadow.map.depthTexture
    u.uShadowMatrix.value.copy(light.shadow.matrix)
    u.uRadius.value = spec.softPx / SHADOW_MAP_SIZE
    // Patch corners in world space (mirrors the display plane in Exhibit local space)
    const tangent = new THREE.Vector3(Math.cos(spec.rotY), 0, -Math.sin(spec.rotY))
    const normal = new THREE.Vector3(Math.sin(spec.rotY), 0, Math.cos(spec.rotY))
    const center = new THREE.Vector3(spec.slotX, 1.62 + spec.patchOffsetY, spec.slotZ).addScaledVector(
      normal,
      0.006
    )
    u.uAxisU.value.copy(tangent).multiplyScalar(spec.patchW)
    u.uAxisV.value.set(0, spec.patchH, 0)
    u.uOrigin.value
      .copy(center)
      .addScaledVector(u.uAxisU.value, -0.5)
      .addScaledVector(u.uAxisV.value, -0.5)
    // Spot irradiance model (same rig the visual light uses)
    u.uLightPos.value.copy(spec.lightPos)
    u.uSpotDir.value.copy(spec.target).sub(spec.lightPos).normalize()
    u.uCosOuter.value = Math.cos(spec.angle)
    u.uCosInner.value = Math.cos(spec.angle * (1 - spec.penumbra))
    u.uRefDist.value = spec.lightPos.distanceTo(spec.target)
    u.uWallNormal.value.copy(normal)

    const prevRT = gl.getRenderTarget()
    gl.setRenderTarget(rt)
    gl.render(bake.scene, bake.camera)
    gl.setRenderTarget(prevRT)

    light.castShadow = false
    onBaked(spec.id, rt.texture)
    s.idx++
    s.stage = 'arm'
  })

  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  )
}
