// Shared light chunk (src/gl/lights.ts): the hand light, the focus gather, up to 4 fireflies, 6 lanterns and the 6
// project flowers' own pools, all with a soft falloff to zero at their reach, and the night that closes in away from the
// roaming visitor. Linear colours.
uniform vec4 uCursor;      // xyz, radius
uniform vec3 uCursorColor;
uniform float uHandOn;     // 1: the hand light shines; 0 under free roam, where the carried lantern (uLamp[0]) does
uniform vec4 uGather;      // xyz, amount
uniform vec4 uFocusBack;   // xyz of the plane the far layers fall back behind, amount (focus, or a bed's rest depth)
uniform vec4 uFly[4];      // xyz, intensity
uniform vec3 uFlyColor;
uniform vec4 uLamp[6];     // flame xyz, strength (0: dark); 0 is the carried lantern, 1 to 5 standing ones (free roam)
uniform vec3 uLampColor;
uniform vec4 uInvite[6];   // the project flowers' own pools: light xyz, strength; the first uInvites burn (free roam only)
uniform int uInvites;
uniform vec3 uInviteColor;
uniform vec2 uVisitor;     // the roaming visitor's ground point x, z
uniform float uFill;       // free roam: a little cool lift on the near ground and plants the lanterns do not reach (0 on the rail)
uniform vec3 uMoonDir;     // the soft key on the faces (upper left front)
uniform vec3 uMoonColor;
uniform vec3 uMoonBack;    // the real moon, low behind the garden: rim and glints
uniform vec3 uRimColor;
uniform vec3 uAmbient;
uniform vec3 uShadowColor;
uniform vec3 uEye;         // z: 0 on the rail, 1 under free roam (the roam air below)

const float FLY_RADIUS = 0.9;
// Place colours tint the sky; on paper, ground and haze they keep only a trace of their hue, so each plate keeps its
// own colour: a cool neutral leaning blue-green in the shade instead of one violet wash over everything.
const vec3 COOL_NEUTRAL = vec3(0.86, 1.0, 1.04);
const float PLACE_HUE_KEPT = 0.2;
vec3 neutralise(vec3 c) { return mix(luma(c) * COOL_NEUTRAL / luma(COOL_NEUTRAL), c, PLACE_HUE_KEPT); }

float falloff(vec3 d, float r) { float k = sat(1.0 - dot(d, d) / (r * r)); return k * k * k; }
// The hand light's spill past its pool: a soft inverse-square tail, so paper beside the pool catches some of it.
const float SPILL = 0.1;
float spill(vec3 d, float r) { return SPILL / (1.0 + 2.0 * dot(d, d) / (r * r)); }

// Warm light from the hand, the gather and the fireflies on a surface at p with normal n.
vec3 handLights(vec3 p, vec3 n) {
  float r = max(uCursor.w, 1e-3);
  vec3 dc = uCursor.xyz - p;
  float fc = falloff(dc, r) + spill(dc, r);
  vec3 dg = uGather.xyz - p;
  float fg = uGather.w * falloff(dg, r * 0.8);
  vec3 c = uCursorColor * (uHandOn * wrapLight(dot(n, normalize(dc + vec3(0.0, 0.0, 1e-3))), 0.25) * fc * (1.0 + fg)
    + 0.6 * fg * wrapLight(dot(n, normalize(dg + vec3(0.0, 0.0, 1e-3))), 0.3));
  for (int i = 0; i < 4; i++) {
    vec3 df = uFly[i].xyz - p;
    c += uFlyColor * uFly[i].w * falloff(df, FLY_RADIUS) * wrapLight(dot(n, normalize(df + vec3(0.0, 1e-3, 0.0))), 0.5);
  }
  return c;
}

// Strength of the hand light at p (0..1), for edges and shadows that follow it.
float handReach(vec3 p) { return falloff(uCursor.xyz - p, max(uCursor.w, 1e-3)); }

// The warm key on a plate colour. Green paper and moss are greyed toward their own value before the amber light
// multiplies in: a warm light on green reads as amber-olive, never as the mint or cyan a green times its value gives.
const float KEY_GREEN_GREY = 0.4;
vec3 keyLit(vec3 albedo, vec3 light) {
  float green = sat((albedo.g - max(albedo.r, albedo.b)) / max(albedo.g, 1e-4) * 2.5);
  return mix(albedo, vec3(luma(albedo)), green * KEY_GREEN_GREY) * light;
}

// The warm key on a cutout's leaves. On a leaf plate the amber light gives way to its own value through a viridian
// filter, so a lit leaf reads as a muted dusk green a step under the lit petals, not cream. `leaf` (0..1) is how
// green the plate is around the fragment; petals, stone, paper and white flowers keep keyLit.
const vec3 LEAF_KEY = vec3(0.035, 0.07, 0.075);
float leafWeight(vec3 c) { return smoothstep(0.04, 0.14, (c.g - 0.5 * (c.r + c.b)) / max(c.g, 1e-4)); }
vec3 leafKeyLit(vec3 albedo, vec3 light, float leaf) {
  return mix(keyLit(albedo, light), albedo * luma(light) * LEAF_KEY, leaf);
}

// A lantern's throw: a soft core windowed to zero at its reach (3.6 m round the carried one, shorter upward), with
// the faint darker rays of the lantern's corner posts, so the pool reads as thrown light, never as a disc. Standing
// lanterns throw smaller, dimmer pools (STAND_GAIN), so the carried one leads and the rest read as lamps along the beds.
const vec3 LAMP_REACH = vec3(3.6, 2.1, 3.6);
const vec3 STAND_REACH = vec3(2.4, 1.6, 2.4);
const float STAND_GAIN = 0.7;
const float LAMP_CORE = 1.5;
const float LAMP_POSTS = 0.22;
float lampFall(vec3 d, vec3 reach) {
  vec3 e = d / reach;
  float q = dot(e, e);
  float posts = 1.0 - LAMP_POSTS * pow(abs(sin(2.0 * atan(d.z, d.x + 1e-4) + 0.4)), 6.0) * sat(q * 8.0);
  return sq(sat(1.0 - q)) / (1.0 + LAMP_CORE * q) * posts;
}
// Amber light from the lanterns on a surface at p with normal n, strongest on the sides that face the flame.
// The carried lantern's own base shades the ground straight below it: a soft dark dot inside its pool.
const vec2 LAMP_FOOT = vec2(0.3, 0.06);   // radius where the dot starts and inside which it is darkest (m)
const float LAMP_FOOT_DARK = 0.9;
// The carried lantern's shadow (gl/shadow.ts): the cutouts and the visitor seen straight down from the flame. The
// receiver steps SHADOW_LIFT metres toward the flame (no acne on the paper that casts), four bilinear compares about
// SHADOW_SOFT texels apart give a soft edge, and the shade keeps SHADOW_KEEP of the light (paper glows through): enough
// that a spiky plant's long shadow reads as a soft shade on the ground, never as black spikes.
uniform mat4 uShadowVP;
uniform highp sampler2DShadow uShadowMap;
uniform float uShadowOn;
const float SHADOW_LIFT = 0.05;
const float SHADOW_SOFT = 2.2;
const float SHADOW_KEEP = 0.42;
float lampShadow(vec3 p, vec3 toLamp) {
  vec4 c = uShadowVP * vec4(p + normalize(toLamp) * SHADOW_LIFT, 1.0);
  vec3 s = c.xyz / c.w * 0.5 + 0.5;
  if (uShadowOn < 0.5 || c.w <= 0.0 || max(abs(s.x - 0.5), abs(s.y - 0.5)) > 0.5) return 1.0;
  vec2 t = SHADOW_SOFT / vec2(textureSize(uShadowMap, 0));
  float lit = texture(uShadowMap, vec3(s.xy + t * vec2(-1.0, -0.4), s.z)) + texture(uShadowMap, vec3(s.xy + t * vec2(0.4, -1.0), s.z))
    + texture(uShadowMap, vec3(s.xy + t * vec2(1.0, 0.4), s.z)) + texture(uShadowMap, vec3(s.xy + t * vec2(-0.4, 1.0), s.z));
  return mix(SHADOW_KEEP, 1.0, lit * 0.25);
}
vec3 lampLightsGain(vec3 p, vec3 n, float carried) {
  float c = 0.0;
  for (int i = 0; i < 6; i++) {
    if (uLamp[i].w <= 0.0) continue;
    vec3 dl = uLamp[i].xyz - p;
    vec3 reach = i == 0 ? LAMP_REACH : STAND_REACH;
    vec3 e = dl / reach;
    if (dot(e, e) >= 1.0) continue;   // outside the pool: lampFall is 0 there
    float l = uLamp[i].w * (i == 0 ? carried : STAND_GAIN) * lampFall(dl, reach) * wrapLight(dot(n, normalize(dl + vec3(0.0, 1e-3, 0.0))), 0.5);
    if (i == 0) l *= (1.0 - LAMP_FOOT_DARK * (1.0 - smoothstep(LAMP_FOOT.y, LAMP_FOOT.x, length(dl.xz))) * step(0.3, dl.y)) * lampShadow(p, dl);
    c += l;
  }
  return uLampColor * c;
}
vec3 lampLights(vec3 p, vec3 n) { return lampLightsGain(p, n, 1.0); }

// The project flowers' invitation: a soft warm pool round each one, reaching its face, its leaves and the ground at its
// foot, so a project reads as the brightest thing in its bed after the carried lantern (the gather light adds on focus).
const vec3 INVITE_REACH = vec3(1.7, 1.5, 1.7);
vec3 inviteLights(vec3 p, vec3 n) {
  float c = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uInvites) break;
    vec3 d = uInvite[i].xyz - p;
    vec3 e = d / INVITE_REACH;
    float q = dot(e, e);
    if (q >= 1.0) continue;
    c += uInvite[i].w * sq(1.0 - q) / (1.0 + 2.0 * q) * wrapLight(dot(n, normalize(d + vec3(0.0, 1e-3, 0.0))), 0.6);
  }
  return uInviteColor * c;
}

// Free roam: the visitor's lantern is the key light and the night closes in away from the visitor. The moon and the fill
// keep NIGHT of their light past NIGHT_REACH.y metres (darker and bluer, never black: the haze, the far air and the
// paper floor still lift it), all of it within NIGHT_REACH.x. 0 on the rail.
const vec2 NIGHT_REACH = vec2(1.5, 7.0);
const vec3 NIGHT = vec3(0.33, 0.38, 0.55);
vec3 nightOf(vec3 p) {
  return mix(vec3(1.0), NIGHT, uEye.z * smoothstep(NIGHT_REACH.x, NIGHT_REACH.y, length(p.xz - uVisitor)));
}

// The near-foreground fill under free roam: full nearer than FILL_NEAR metres from the lens, gone past FILL_FAR.
const vec2 FILL_DEPTH = vec2(8.0, 12.0);
float fillAt(float depth) { return uFill * (1.0 - smoothstep(FILL_DEPTH.x, FILL_DEPTH.y, depth)); }

// Air between the layers, banded by depth against the hand's plane (+ behind it, - in front): far layers sit lifted
// and cooler in the dusk air, near layers darker and richer. `back` is the fall-off behind a focused flower (0..1).
// Under free roam the hand's plane is the visitor, so the whole bed behind the figure counts as far: there the far band
// starts later and mixes less air (uEye.z), so the beds behind the visitor keep their colour.
const vec3 FAR_AIR = vec3(0.027, 0.030, 0.058);    // #2d3044, a cool slate, not violet
const vec3 FAR_HUE = vec3(0.92, 0.99, 1.15);         // the cool lean of far paper at its own value
const float FAR_AIR_MIX = 0.42;
const float ROAM_FAR_AIR_MIX = 0.18;
const vec2 FAR_BAND = vec2(0.5, 3.0);                // metres behind the hand's plane where the far air starts and is full
const vec2 ROAM_FAR_BAND = vec2(3.0, 8.0);
const float FAR_COOL = 0.45;
const float NEAR_DARK = 0.6;
const float ROAM_NEAR_DARK = 0.85;                   // free roam walks on that near ground: it stays readable
const float NEAR_RICH = 0.15;
const float FOCUS_DARK = 0.38;
vec3 layerAir(vec3 c, float rel, float back) {
  vec2 band = mix(FAR_BAND, ROAM_FAR_BAND, uEye.z);
  float far = smoothstep(band.x, band.y, rel);
  float near = smoothstep(0.3, 1.5, -rel);
  c = mix(c, luma(c) * FAR_HUE, far * FAR_COOL);
  c = mix(c, FAR_AIR, far * mix(FAR_AIR_MIX, ROAM_FAR_AIR_MIX, uEye.z));
  c *= mix(1.0, mix(NEAR_DARK, ROAM_NEAR_DARK, uEye.z), near);
  c = max(mix(vec3(luma(c)), c, 1.0 + NEAR_RICH * near), 0.0);
  return c * (1.0 - FOCUS_DARK * back);
}
