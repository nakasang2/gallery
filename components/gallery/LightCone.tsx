'use client'
// Fake volumetric light: draw a spotlight's light shaft as an additively blended
// cone. No ray marching, so it's nearly free, and combined with the dust it gives
// the museum atmosphere of "dust drifting through the light"
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { disposeAll } from './textures'

const vertexShader = /* glsl */ `
  varying float vAxis;      // 1 = light source side, 0 = tip
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
    // Denser toward the source and toward the center seen head-on (edges fade where the view and normal are perpendicular)
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
    const length = dir.length() * 0.94 // fades out just short of the artwork
    dir.normalize()
    const radiusEnd = Math.tan(angle * 0.8) * length
    const geo = new THREE.CylinderGeometry(0.05, radiusEnd, length, 20, 1, true)
    geo.translate(0, -length / 2, 0) // origin = light source, extends along -Y
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
