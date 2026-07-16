'use client'
// Continuous height fog (post-process): reconstruct each pixel's world position from
// the depth buffer and accumulate fog by distance from camera x height falloff. Being
// per-pixel continuous, it can't show the "layer stepping" of sprite-based fog. A single
// full-screen pass, so it's cheap
import { forwardRef, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Effect, EffectAttribute } from 'postprocessing'
import { Uniform, Matrix4, Color, type Camera } from 'three'

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uDensity;   // fog thickness per unit distance
  uniform float uFalloff;   // falloff along height (higher = pools lower down)
  uniform float uFloor;     // height where the fog is thickest (floor)
  uniform float uIntensity; // overall strength
  uniform mat4 uProjInv;
  uniform mat4 uCamWorld;

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    // depth -> clip -> reconstruct view-space position
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uProjInv * clip;
    view.xyz /= view.w;
    float dist = length(view.xyz); // distance from camera
    // world position (used to evaluate height)
    vec4 world = uCamWorld * vec4(view.xyz, 1.0);
    vec3 camPos = uCamWorld[3].xyz;
    // Set density from the average height of camera and pixel (lower = thicker)
    float avgY = (camPos.y + world.y) * 0.5;
    float heightAtten = exp(-max(avgY - uFloor, 0.0) * uFalloff);
    float fog = 1.0 - exp(-dist * uDensity * heightAtten);
    fog = clamp(fog * uIntensity, 0.0, 1.0);
    outputColor = vec4(mix(inputColor.rgb, uColor, fog), inputColor.a);
  }
`

export interface HeightFogParams {
  color: number
  density: number
  falloff: number
  floor: number
  intensity: number
}

class HeightFogEffect extends Effect {
  camera: Camera | null = null

  constructor(p: HeightFogParams) {
    super('HeightFogEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uColor', new Uniform(new Color(p.color))],
        ['uDensity', new Uniform(p.density)],
        ['uFalloff', new Uniform(p.falloff)],
        ['uFloor', new Uniform(p.floor)],
        ['uIntensity', new Uniform(p.intensity)],
        ['uProjInv', new Uniform(new Matrix4())],
        ['uCamWorld', new Uniform(new Matrix4())],
      ]),
    })
  }

  update() {
    const cam = this.camera
    if (!cam) return
    ;(this.uniforms.get('uProjInv')!.value as Matrix4).copy(cam.projectionMatrixInverse)
    ;(this.uniforms.get('uCamWorld')!.value as Matrix4).copy(cam.matrixWorld)
  }
}

export default forwardRef<HeightFogEffect, HeightFogParams>(function HeightFog(props, ref) {
  const camera = useThree((s) => s.camera)
  const effect = useMemo(() => new HeightFogEffect(props), []) // eslint-disable-line react-hooks/exhaustive-deps
  effect.camera = camera

  useLayoutEffect(() => {
    ;(effect.uniforms.get('uColor')!.value as Color).set(props.color)
    effect.uniforms.get('uDensity')!.value = props.density
    effect.uniforms.get('uFalloff')!.value = props.falloff
    effect.uniforms.get('uFloor')!.value = props.floor
    effect.uniforms.get('uIntensity')!.value = props.intensity
  }, [effect, props.color, props.density, props.falloff, props.floor, props.intensity])

  useLayoutEffect(() => () => effect.dispose(), [effect])

  return <primitive ref={ref} object={effect} dispose={null} />
})
