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
  varying vec3 vAxisView;   // beam axis in view space
  void main() {
    vAxis = uv.y;
    vNormal = normalize(normalMatrix * normal);
    vAxisView = normalize((modelViewMatrix * vec4(0.0, -1.0, 0.0, 0.0)).xyz);
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
  varying vec3 vAxisView;
  void main() {
    // Denser toward the source and toward the center seen head-on (edges fade where the view and normal are perpendicular)
    float axial = pow(vAxis, 1.7);
    float edge = pow(abs(dot(normalize(vNormal), normalize(vViewDir))), 1.4);
    // A real shaft is brightest looking ALONG the beam and nearly invisible from
    // the side — without this the double-sided cone reads as a white slab when
    // seen side-on across the room.
    float along = abs(dot(normalize(vViewDir), normalize(vAxisView)));
    float axisFade = mix(0.22, 1.0, pow(along, 1.6));
    float a = axial * edge * axisFade * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }
`

/** Cones live on this layer only: the main camera enables it (GalleryScene), but the
 *  floor's planar-reflection camera (layer 0 only) never sees them — reflected light
 *  shafts otherwise smear into a big white wash on the polished floor. */
export const CONE_LAYER = 11

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

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      quaternion={quaternion}
      layers-mask={1 << CONE_LAYER}
    />
  )
}
