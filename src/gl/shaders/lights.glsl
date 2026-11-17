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
