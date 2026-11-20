// Wrought iron (src/gl/irongate.ts), after common.glsl and lights.glsl: dark iron with rust gathered low down and in
// blooms, lit by the moon and the lanterns like the paper round it. Faces turning away from the eye go to graphite, so
// the bars read as drawn lines; the cutouts' haze and layer air follow.
uniform vec4 uHaze;          // haze rgb, density per metre past 7 m (the cutouts' ROAM_HAZE_START)
uniform vec3 uCamPos;
uniform float uShadowPass;   // 1 while the lantern's shadow map draws: depth only

in vec3 vWorld;
in vec2 vDepth;              // the fragment's view depth and the hand's plane's
out vec4 outColor;

const vec3 IRON = vec3(0.020, 0.019, 0.023);      // #27262b dark iron, linear
const vec3 RUST = vec3(0.060, 0.026, 0.014);      // #45291f dull rust, linear
const vec3 GRAPHITE = vec3(0.011, 0.010, 0.012);  // the cutouts' pencil line

void main() {
  outColor = vec4(0.0);
  if (uShadowPass > 0.5) return;
  vec3 v = normalize(uCamPos - vWorld);
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  n *= sign(dot(n, v));        // the face's own normal, turned to the eye
  // Blooms about 3 cm across, heaviest under 8 cm and gone past 55 cm.
  float rust = smoothstep(0.5, 0.78, fbm3(vWorld.xy * 34.0) + 0.3 - 0.3 * smoothstep(0.08, 0.55, vWorld.y));
  vec3 lit = mix(IRON, RUST, rust * 0.7) * (neutralise(uAmbient + uMoonColor * wrapLight(dot(n, uMoonDir), 0.2)) * nightOf(vWorld) + lampLights(vWorld, n));
  float hazed = 1.0 - exp(-max(vDepth.x - 7.0, 0.0) * uHaze.w);
  lit = layerAir(mix(lit, neutralise(uHaze.rgb), hazed), vDepth.x - vDepth.y, 0.0);
  outColor = vec4(mix(lit, GRAPHITE, 0.7 * (1.0 - smoothstep(0.08, 0.5, abs(dot(n, v)))) * (1.0 - hazed)), 1.0);
}
