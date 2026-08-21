'use client'
// 部屋の光を1枚のテクスチャに焼く（照明の焼き込み ②・DECISIONS 2026-08-19）。
//
// `WallShadowBaker` が焼いているのは**影**（作品の輪郭）で、こちらは**光だまりそのもの**。
// 焼いたあとの壁・床・間仕切りは「照らされる面」ではなく「もう明るさが決まっている面」に
// なるので、作品ごとのスポット（最大15灯）をシーンから外せる ── 実測で「照明を外すと
// 13.8 → 30以上」だったところの本命。
//
// **影と違って保存しない。** 影は1作品につき 2048x2048 の深度マップを描くので焼くのが
// 重く、出展時に1回だけ焼いて保存する価値があった（DECISIONS 2026-08-18 ①）。光は
// 深度マップが要らず、面ごとに板を1枚描くだけ＝**部屋ぜんぶで1フレーム**なので、
// 保存の仕組み（R2・指紋・容量・進捗UI）を増やす理由が無い。焼けない端末も無い
// （影と違い `gl.shadowMap` に依存しないので、低スペック機にも同じ光が乗る）。
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { packLightAtlas, type LightPlan, type LitRect } from './lightPlan'

/** 焼き上がり。テクスチャと、面の id → その面が占める区画。**1つの値で渡す**
 *  ── 区画を伴わないテクスチャは、どの面に貼っても部屋じゅうの光が1面に乗る。 */
export interface LightAtlas {
  tex: THREE.Texture
  rects: Record<string, LitRect>
}

/** シェーダーに埋め込む照明の上限。1部屋の最大は作品15灯なので余裕を持たせてある。
 *  **超えた分は焼かれない**ので、スロットを増やしたらここも増やす。 */
const MAX_SPOTS = 24

const vert = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// three.js の `getSpotLightInfo` / `getDistanceAttenuation` / `getHemisphereLightIrradiance`
// と**同じ式**を組み立てる。ここがずれると、焼いた壁と、まだ実照明で照らしている
// 立体（作品・額）の明るさが食い違って、額の周りだけ色が変わって見える。
const frag = /* glsl */ `
  precision highp float;
  uniform vec3 uOrigin;
  uniform vec3 uAxisU;
  uniform vec3 uAxisV;
  uniform vec3 uNormal;
  uniform int uCount;
  uniform vec3 uPos[${MAX_SPOTS}];
  uniform vec3 uDir[${MAX_SPOTS}];
  uniform vec3 uColor[${MAX_SPOTS}];
  uniform float uConeCos[${MAX_SPOTS}];
  uniform float uPenumbraCos[${MAX_SPOTS}];
  uniform float uDecay[${MAX_SPOTS}];
  uniform float uDistance[${MAX_SPOTS}];
  in vec2 vUv;
  out vec4 outColor;

  float distanceAttenuation(float d, float cutoff, float decay) {
    float falloff = 1.0 / max(pow(d, decay), 0.01);
    if (cutoff > 0.0) {
      float t = clamp(1.0 - pow(d / cutoff, 4.0), 0.0, 1.0);
      falloff *= t * t;
    }
    return falloff;
  }

  void main() {
    vec3 world = uOrigin + uAxisU * vUv.x + uAxisV * vUv.y;
    // 地明かりと環境マップは焼かない。壁も床も実照明を見る材質のままなので、
    // ambientLight / hemisphereLight / scene.environment は今までどおり実物が効く。
    // ここで焼くのは作品スポットの (1 - POOL_MIX) ぶんだけ。
    vec3 irradiance = vec3(0.0);
    for (int i = 0; i < ${MAX_SPOTS}; i++) {
      if (i >= uCount) break;
      vec3 lv = uPos[i] - world;
      float d = max(length(lv), 1e-4);
      vec3 ldir = lv / d;
      float atten = smoothstep(uConeCos[i], uPenumbraCos[i], dot(ldir, uDir[i]));
      if (atten <= 0.0) continue;
      atten *= distanceAttenuation(d, uDistance[i], uDecay[i]);
      irradiance += uColor[i] * atten * max(dot(uNormal, ldir), 0.0);
    }
    outColor = vec4(irradiance, 1.0);
  }
`

export default function LightmapBaker({
  plan,
  onBaked,
  onFailed,
}: {
  plan: LightPlan
  /** 焼き上がった瞬間に1回だけ呼ばれる。 */
  onBaked: (atlas: LightAtlas) => void
  /** 諦めた（必要な拡張が無い、または`MAX_ATTEMPTS`回失敗）ときに1回だけ呼ばれる。
   *  **呼ばなくても部屋は壊れない** ── 焼けなかった壁は地明かりだけの25%の明るさに
   *  固定されるだけで、来場者には「なんとなく暗い部屋」としか見えず、これが無いと
   *  誰にも報告されず検知できない（リリース前監査 #9・2026-08-21）。 */
  onFailed?: (reason: string) => void
}) {
  const gl = useThree((s) => s.gl)

  // GLSL3（`in`/`out`）を使っている以上WebGL2必須で、そのWebGL2で`HalfFloatType`の
  // レンダーターゲットに描くにはどちらかの拡張が要る（three.js の
  // `WebGLCapabilities.halfFloatSupportedByExt` と同じOR条件 ── 片方だけしか
  // 実装していないドライバもあるので、`EXT_color_buffer_half_float` だけを見ると
  // 焼けるはずの端末まで誤って諦めさせる）。無い環境で焼こうとすると three.js は
  // 例外を投げずに `console.error` だけ出してフレームバッファへの書き込みを黒の
  // まま諦める ── 下のリトライ／例外捕捉では検知できない失敗モードなので、ここで
  // 先に弾く。
  const halfFloatOk = useMemo(
    () => gl.extensions.has('EXT_color_buffer_half_float') || gl.extensions.has('EXT_color_buffer_float'),
    [gl]
  )

  const layout = useMemo(() => packLightAtlas(plan.surfaces), [plan.surfaces])

  const target = useMemo(
    () =>
      new THREE.WebGLRenderTarget(layout.size, layout.size, {
        depthBuffer: false,
        stencilBuffer: false,
        // 半精度浮動小数。照度は 1.0 を軽く超える（Noir のスポットは作品の位置で 3 以上）ので、
        // 8bit だと**光だまりの芯が真っ白に潰れて平らになる**。
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      }),
    [layout.size]
  )
  useEffect(() => {
    // **2枚目の uv（`uv1`）で読む。** three.js はライトマップの uv を
    // `texture.channel` で選ぶ（既定は 0 ＝ 仕上げのマップと同じ `uv`）。1 にし忘れると
    // **アトラス1枚を壁1枚いっぱいに引き伸ばして貼る** ── 部屋じゅうの光が縮小されて
    // 全部の壁に乗るので、画面は「なんとなく暗い壁」になり、原因に見えない（実際に踏んだ）。
    target.texture.channel = 1
  }, [target])
  // **後始末は `target` だけに依存させる。** ここに `layout` を混ぜると、`layout` は
  // 毎レンダー作り直される入れ物なので**毎フレーム後始末が走ってテクスチャを捨て**、
  // 焼いた光が一度も画面に出ない（実際に踏んだ。壁が真っ黒になり、原因は焼き込み側にしか
  // 見えなかった）。
  useEffect(() => () => target.dispose(), [target])
  useEffect(() => {
    // 試作時の実測用（`__scene` / `__bakeAtlas` と同じ作法）。区画も一緒に出す
    // ── テクスチャだけでは「どの壁のどこを読んだのか」が分からず、実測にならない。
    ;(window as unknown as Record<string, unknown>).__lightAtlas = target
    ;(window as unknown as Record<string, unknown>).__lightRects = layout.rects
  }, [target, layout])

  const bake = useMemo(() => {
    const scene = new THREE.Scene()
    const uniforms: Record<string, THREE.IUniform> = {
      uOrigin: { value: new THREE.Vector3() },
      uAxisU: { value: new THREE.Vector3() },
      uAxisV: { value: new THREE.Vector3() },
      uNormal: { value: new THREE.Vector3() },
      uCount: { value: 0 },
      uPos: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector3()) },
      uDir: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector3()) },
      uColor: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Color()) },
      uConeCos: { value: new Array(MAX_SPOTS).fill(0) },
      uPenumbraCos: { value: new Array(MAX_SPOTS).fill(0) },
      uDecay: { value: new Array(MAX_SPOTS).fill(2) },
      uDistance: { value: new Array(MAX_SPOTS).fill(0) },
    }
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: frag,
      uniforms,
      depthTest: false,
      depthWrite: false,
    })
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
    return { scene, mat, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }
  }, [])
  useEffect(() => () => bake.mat.dispose(), [bake])

  // **焼き終わってから「済んだ」にする。** 先に立てると、途中で例外が出た（珍しい
  // ドライバでのシェーダー失敗・面の途中でのコンテキスト消失）ときに**半分だけ焼けた
  // アトラスのまま二度と焼き直さない**（その壁だけ 25% の暗さで固定される）。
  // 失敗しても諦めずに次のフレームで焼き直し、**それでも駄目なら数回で打ち切る**
  // ── 毎フレーム重い描画を投げ続けるほうが害が大きい。
  const done = useRef('')
  const attempts = useRef({ key: '', n: 0 })
  const reported = useRef('')
  const MAX_ATTEMPTS = 3

  useFrame(() => {
    if (done.current === plan.key) return
    if (!halfFloatOk) {
      done.current = plan.key
      if (reported.current !== plan.key) {
        reported.current = plan.key
        onFailed?.('no-half-float-ext')
      }
      return
    }
    if (attempts.current.key !== plan.key) attempts.current = { key: plan.key, n: 0 }
    if (attempts.current.n >= MAX_ATTEMPTS) {
      if (reported.current !== plan.key) {
        reported.current = plan.key
        onFailed?.('max-attempts')
      }
      return
    }
    attempts.current.n++

    const u = bake.mat.uniforms
    const n = Math.min(plan.spots.length, MAX_SPOTS)
    u.uCount.value = n
    const dir = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const s = plan.spots[i]
      ;(u.uPos.value as THREE.Vector3[])[i].copy(s.pos)
      // **three.js の `spotLight.direction` は「的 → 光源」**（`WebGLLights` が
      // `position - target` を正規化して入れている）。ここを「光源 → 的」で入れると
      // `dot(面→光源, uDir)` が円錐の内側でちょうど -1 になり、`smoothstep` が全部 0 に
      // 落ちる ── **照明が1灯も焼かれず、地明かりだけの平らな壁になる**（実際に踏んだ）。
      ;(u.uDir.value as THREE.Vector3[])[i].copy(dir.copy(s.pos).sub(s.target).normalize())
      // WebGLLights と同じ: 色に強さを掛けたものを1つの値として渡す
      ;(u.uColor.value as THREE.Color[])[i].copy(s.color).multiplyScalar(s.intensity)
      ;(u.uConeCos.value as number[])[i] = Math.cos(s.angle)
      ;(u.uPenumbraCos.value as number[])[i] = Math.cos(s.angle * (1 - s.penumbra))
      ;(u.uDecay.value as number[])[i] = s.decay
      ;(u.uDistance.value as number[])[i] = s.distance
    }

    // 描画先・`autoClear`・消去色は**どれもレンダラー全体の状態なので、3つとも
    // `finally` で戻す**（`WallShadowBaker` と同じ理由: 途中で投げると `autoClear` が
    // 切れたままになり、以後キャンバスが一度も消えなくなる）。**消去色だけ `try` の中で
    // 戻す形を一度作りかけた** ── その手前で投げると黒のまま残り、以後キャンバスが
    // 真っ黒に消され続ける。
    const prevRT = gl.getRenderTarget()
    const prevAutoClear = gl.autoClear
    const prevClear = new THREE.Color()
    gl.getClearColor(prevClear)
    const prevClearAlpha = gl.getClearAlpha()
    try {
      // **面ごとに区画へ描く前に、1度だけ全面を消す。** 消さないと、焼き直したときに
      // 前の構成の光が区画の外に残る（アトラスの詰め方は構成で変わる）。
      // 消す色は**明示的に黒**にする ── `gl.clear()` はレンダラー全体の消去色を使うので、
      // 後処理や他の描画がそれを触っていると、区画の外に一定の光が残る器になる。
      gl.setClearColor(0x000000, 0)
      target.viewport.set(0, 0, layout.size, layout.size)
      target.scissor.set(0, 0, layout.size, layout.size)
      gl.setRenderTarget(target)
      gl.autoClear = false
      gl.clear(true, false, false)
      for (const s of plan.surfaces) {
        const px = layout.px[s.id]
        if (!px) continue
        ;(u.uOrigin.value as THREE.Vector3).copy(s.origin)
        ;(u.uAxisU.value as THREE.Vector3).copy(s.axisU)
        ;(u.uAxisV.value as THREE.Vector3).copy(s.axisV)
        ;(u.uNormal.value as THREE.Vector3).copy(s.normal)
        target.viewport.set(px.x, px.y, px.w, px.h)
        gl.setRenderTarget(target)
        gl.render(bake.scene, bake.camera)
      }
    } catch (e) {
      // 珍しいドライバでのシェーダー失敗・面の途中でのコンテキスト消失。ここで
      // 握って次のフレームで（`MAX_ATTEMPTS`まで）やり直す ── 投げっぱなしにすると、
      // R3F のフレームループはこの呼び出しを try/catch で囲っていないため、この
      // フレームに限って後続のsubscriber（影の焼き込み・徒歩移動 等）が丸ごと
      // 動かなくなる（three.jsのソースで確認・実際には起きていないはずのフレーム落ち）。
      console.warn('lightmap bake failed, will retry', e)
      return
    } finally {
      gl.setRenderTarget(prevRT)
      gl.autoClear = prevAutoClear
      gl.setClearColor(prevClear, prevClearAlpha)
    }

    done.current = plan.key
    onBaked({ tex: target.texture, rects: layout.rects })
  })

  return null
}
