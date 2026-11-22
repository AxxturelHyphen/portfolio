// Chalk marks (src/gl/chalk.ts), after common.glsl and lights.glsl. The atlas holds the hand's strokes: r is how much
// chalk the stroke laid down, g when it was laid (0..1 over the mark) times r, so a mark chalks itself on as uMarks.x grows.
// The dust breaks up where the stick skipped over the grain of the stone, and the chalk is lit as the stone under it:
// the dusk ambient, the moon key, the lanterns and the night away from the visitor, then the haze. Rolled off under a
// ceiling well below paper white, so it never glows.
uniform sampler2D uChalk;
uniform vec4 uHaze;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vDepth;
flat in vec2 vMark;
flat in vec3 vTint;
out vec4 outColor;

const float ROAM_HAZE_START = 7.0;
const float AMBIENT_GAIN = 1.6;
const float FILL = 0.6;
const float CEIL = 0.55;
const float OPACITY = 0.95;
// Texels per grain of the stone the stick skips on, and how much of a stroke the skipping breaks away. A far or
// grazing mark samples a coarse mip where the thin strokes have thinned to grey: the coverage is lifted (GAIN) so the
// skipping never wipes them out, and the lookup leans one mip finer.
const vec2 GRAIN = vec2(1.6, 5.5);
const vec2 SKIP = vec2(0.12, 0.5);
const float GAIN = 2.2;
const float MIP_BIAS = -0.75;
// The soft front of the stroke as it is being drawn (share of the mark's time).
const float NIB = 0.015;

void main() {
  vec4 t = texture(uChalk, vUv, MIP_BIAS);
  float cover = min(1.0, t.r * GAIN);
  vec2 q = vUv * vec2(textureSize(uChalk, 0));
  float fine = valueNoise(q / GRAIN.x);
  float coarse = valueNoise(q / GRAIN.y + 17.0);
  float dust = cover * smoothstep(SKIP.x, SKIP.y, fine * 0.6 + coarse * 0.4) * mix(0.7, 1.0, coarse);
  float drawn = vMark.x >= 1.0 ? 1.0 : 1.0 - smoothstep(vMark.x - NIB, vMark.x, t.g / max(t.r, 1e-3));
  float a = dust * drawn * vMark.y * OPACITY;
  if (a < 0.004) discard;

  vec3 n = normalize(vNormal);
  vec3 night = nightOf(vWorld);
  vec3 ambient = neutralise(uAmbient) * AMBIENT_GAIN * mix(0.8, 1.25, n.y * 0.5 + 0.5) * (1.0 + FILL * fillAt(vDepth));
  vec3 key = neutralise(uMoonColor) * wrapLight(dot(n, uMoonDir), 0.4);
  vec3 hand = handLights(vWorld, n) + lampLights(vWorld, n) + inviteLights(vWorld, n);
  vec3 lit = vTint * (ambient + key) * night + keyLit(vTint, hand);
  lit /= 1.0 + lit / CEIL;
  float hazed = 1.0 - exp(-max(vDepth - ROAM_HAZE_START, 0.0) * uHaze.w);
  outColor = vec4(mix(lit, neutralise(uHaze.rgb), hazed) * a, a);
}
