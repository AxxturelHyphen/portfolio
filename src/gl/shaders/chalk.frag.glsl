// Chalk marks (src/gl/chalk.ts), after common.glsl and lights.glsl. The atlas holds the hand's strokes: r is how much
// chalk the stroke laid down, g when it was laid (0..1 over the mark) times r, so a mark chalks itself on as uMarks.x grows.
// The dust breaks up where the stick skipped over the grain of the stone, and the chalk is lit as the stone under it:
// the dusk ambient, the moon key, the lanterns and the night away from the visitor, then the haze. Rolled off under a
// ceiling well below paper white, so it never glows. A thin soft dark under-stroke (the strokes blurred by a coarser
// mip) keeps the chalk legible against a bright sky or a sunlit wall; at night it vanishes into the dark. A floating
// mark boils (its dust and its line shift a little BOIL_FPS times a second while its clock runs); a mark being rubbed
// out smears sideways as it fades.
uniform sampler2D uChalk;
uniform vec4 uHaze;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vDepth;
flat in vec4 vMark;
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
// The under-stroke: how much coarser its mip, its strength and its colour (linear).
const float UNDER_BIAS = 2.2;
const float UNDER = 0.45;
const vec3 UNDER_TINT = vec3(0.02, 0.018, 0.016);
// The boil: steps per second and how far the line shifts (texels); the smear's reach (texels).
const float BOIL_FPS = 8.0;
const float BOIL_TEXELS = 0.9;
const float SMEAR_TEXELS = 14.0;

float drawnAt(vec4 t) {
  return vMark.x >= 1.0 ? 1.0 : 1.0 - smoothstep(vMark.x - NIB, vMark.x, t.g / max(t.r, 1e-3));
}

void main() {
  vec2 size = vec2(textureSize(uChalk, 0));
  float boil = vMark.w > 0.0 ? floor(vMark.w * BOIL_FPS) : 0.0;
  vec2 uv = vUv + (hash22(vec2(boil, 3.7)) - 0.5) * step(0.0001, vMark.w) * BOIL_TEXELS / size;
  vec2 smear = vec2(vMark.z * SMEAR_TEXELS / size.x, 0.0);
  vec4 t = mix(texture(uChalk, uv, MIP_BIAS), texture(uChalk, uv - smear, MIP_BIAS), 0.5 * vMark.z);
  float cover = min(1.0, t.r * GAIN);
  vec2 q = uv * size + boil * vec2(13.1, 7.7);
  float fine = valueNoise(q / GRAIN.x);
  float coarse = valueNoise(q / GRAIN.y + 17.0);
  float dust = cover * smoothstep(SKIP.x, SKIP.y, fine * 0.6 + coarse * 0.4) * mix(0.7, 1.0, coarse);
  float a = dust * drawnAt(t) * vMark.y * OPACITY;
  vec4 halo = texture(uChalk, uv, UNDER_BIAS);
  float under = min(1.0, halo.r * GAIN * 2.0) * drawnAt(halo) * vMark.y * (1.0 - vMark.z) * UNDER;
  if (a + under < 0.004) discard;

  vec3 n = normalize(vNormal);
  vec3 night = nightOf(vWorld);
  vec3 ambient = skyFill(n) * AMBIENT_GAIN * (1.0 + FILL * fillAt(vDepth));
  vec3 key = keyLight(vWorld, n, 0.4);
  vec3 hand = handLights(vWorld, n) + lampLights(vWorld, n) + inviteLights(vWorld, n);
  vec3 lit = vTint * (ambient + key) * night + keyLit(vTint, hand);
  lit /= 1.0 + lit / CEIL;
  float hazed = 1.0 - exp(-max(vDepth - ROAM_HAZE_START, 0.0) * uHaze.w);
  float shade = under * (1.0 - a);
  outColor = vec4(mix(lit, neutralise(uHaze.rgb), hazed) * a + UNDER_TINT * shade, a + shade);
}
