'use client'
// フェイク・ボリューメトリックライト: スポットライトの光のシャフトを
// 加算合成の円錐で描く。レイマーチング不要でほぼ無コスト、塵と合わさると
// 「光の中を塵が舞う」美術館の空気感になる
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { disposeAll } from './textures'

const vertexShader = /* glsl */ `
  varying float vAxis;      // 1 = 光源側, 0 = 先端
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vAxis = uv.y;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAxis;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    // 光源側ほど濃く、正面から見た中心ほど濃く(縁は視線と法線が直交して消える)
    float axial = pow(vAxis, 1.7);
    float edge = pow(abs(dot(normalize(vNormal), normalize(vViewDir))), 1.4);
    float a = axial * edge * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }
`

export default function LightCone({
  from,
  to,
  angle,
  color,
  opacity,
}: {
  from: THREE.Vector3
  to: THREE.Vector3
  angle: number
  color: number
  opacity: number
}) {
  const { geometry, position, quaternion, material } = useMemo(() => {
    const dir = to.clone().sub(from)
    const length = dir.length() * 0.94 // 作品の少し手前で消える
    dir.normalize()
    const radiusEnd = Math.tan(angle * 0.8) * length
    const geo = new THREE.CylinderGeometry(0.05, radiusEnd, length, 20, 1, true)
    geo.translate(0, -length / 2, 0) // 原点=光源、-Y方向に伸びる
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    return { geometry: geo, position: from.clone(), quaternion: q, material: mat }
  }, [from, to, angle, color, opacity])

  useEffect(() => () => disposeAll([geometry, material]), [geometry, material])

  return <mesh geometry={geometry} material={material} position={position} quaternion={quaternion} />
}
