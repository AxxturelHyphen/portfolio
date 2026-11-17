// Shared light chunk (src/gl/lights.ts): the hand light, the focus gather and up to 4 fireflies, all with a soft
// quadratic falloff to zero at their radius. Linear colours.
uniform vec4 uCursor;      // xyz, radius
uniform vec3 uCursorColor;
uniform vec4 uGather;      // xyz, amount
uniform vec4 uFly[4];      // xyz, intensity
uniform vec3 uFlyColor;
uniform vec3 uMoonDir;     // the soft key on the faces (upper left front)
uniform vec3 uMoonColor;
uniform vec3 uMoonBack;    // the real moon, low behind the garden: rim and glints
uniform vec3 uRimColor;
uniform vec3 uAmbient;
uniform vec3 uShadowColor;

const float FLY_RADIUS = 0.9;
// Place colours tint the sky; on paper, ground and haze they keep only a trace of their hue, so each plate keeps its
// own colour: a cool neutral leaning blue-green in the shade instead of one violet wash over everything.
const vec3 COOL_NEUTRAL = vec3(0.86, 1.0, 1.04);
const float PLACE_HUE_KEPT = 0.2;
vec3 neutralise(vec3 c) { return mix(luma(c) * COOL_NEUTRAL / luma(COOL_NEUTRAL), c, PLACE_HUE_KEPT); }

float falloff(vec3 d, float r) { float k = sat(1.0 - dot(d, d) / (r * r)); return k * k * k; }

// Warm light from the hand, the gather and the fireflies on a surface at p with normal n.
vec3 handLights(vec3 p, vec3 n) {
  float r = max(uCursor.w, 1e-3);
  vec3 dc = uCursor.xyz - p;
  float fc = falloff(dc, r);
  vec3 dg = uGather.xyz - p;
  float fg = uGather.w * falloff(dg, r * 0.8);
  vec3 c = uCursorColor * (wrapLight(dot(n, normalize(dc + vec3(0.0, 0.0, 1e-3))), 0.25) * fc * (1.0 + fg)
    + 0.6 * fg * wrapLight(dot(n, normalize(dg + vec3(0.0, 0.0, 1e-3))), 0.3));
  for (int i = 0; i < 4; i++) {
    vec3 df = uFly[i].xyz - p;
    c += uFlyColor * uFly[i].w * falloff(df, FLY_RADIUS) * wrapLight(dot(n, normalize(df + vec3(0.0, 1e-3, 0.0))), 0.5);
  }
  return c;
}

// Strength of the hand light at p (0..1), for edges and shadows that follow it.
float handReach(vec3 p) { return falloff(uCursor.xyz - p, max(uCursor.w, 1e-3)); }

// The warm key on a plate colour: lit by value with a little of the key's warmth. Greens take the key's value only,
// so leaves brighten without turning acid yellow-green.
const vec3 KEY_WARMTH = vec3(1.08, 1.0, 0.86);
vec3 keyLit(vec3 albedo, vec3 light) {
  float green = sat((albedo.g - max(albedo.r, albedo.b)) / max(albedo.g, 1e-4) * 2.5);
  return mix(albedo * light, albedo * luma(light) * KEY_WARMTH, green);
}

// Air between the layers, banded by depth against the hand's plane (+ behind it, - in front): far layers sit lifted
// and cooler in the dusk air, near layers darker and richer. `back` is the fall-off behind a focused flower (0..1).
const vec3 FAR_AIR = vec3(0.018, 0.019, 0.045);    // #24263c, a cool slate, not violet
const vec3 FAR_HUE = vec3(0.92, 0.99, 1.15);         // the cool lean of far paper at its own value
const float FAR_AIR_MIX = 0.25;
const float FAR_COOL = 0.35;
const float NEAR_DARK = 0.75;
const float NEAR_RICH = 0.15;
const float FOCUS_DARK = 0.38;
vec3 layerAir(vec3 c, float rel, float back) {
  float far = smoothstep(0.5, 3.0, rel);
  float near = smoothstep(0.3, 1.5, -rel);
  c = mix(c, luma(c) * FAR_HUE, far * FAR_COOL);
  c = mix(c, FAR_AIR, far * FAR_AIR_MIX);
  c *= mix(1.0, NEAR_DARK, near);
  c = max(mix(vec3(luma(c)), c, 1.0 + NEAR_RICH * near), 0.0);
  return c * (1.0 - FOCUS_DARK * back);
}
