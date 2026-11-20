// The still pond (common.glsl and lights.glsl prepended): dark water that mirrors the sky, the moon as a long broken
// column, slow ripples, rings under the hand light, a soft wet bank and the nearby cutouts as vertical smears. Alive
// under the visitor: the lanterns as warm wobbling columns, the wake spreading from the bank, rings and a wet rim round
// the floating pads, and a slow shimmer on the mirrored sky. Linear colour, premultiplied output.
uniform vec3 uCamPos;
uniform float uTime;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec4 uRect;
uniform vec4 uRefl[8];       // foot x, z, height, width
uniform vec3 uReflColour[8]; // linear plate colour
uniform int uReflCount;
uniform vec4 uWake[6];       // x, z, birth time, amplitude (0: spent), pond.wake.ts
uniform vec4 uPads[6];       // centre x, z, radius, phase
uniform int uPadCount;
uniform float uCalm;         // 1 under reduced motion: the shimmer holds still

in vec3 vWorld;
in vec2 vLocal;
out vec4 outColor;

const vec3 DEEP = vec3(0.0060, 0.0072, 0.0110);       // still water in shade: near black, a little blue-green
const vec3 MOON_WATER = vec3(0.72, 0.66, 0.60);       // #ddd4cb on the water, held under the moon core
const float SKY_MIRROR = 0.32;
// Free roam sees the pond from 7 to 14 m at a low angle: more of the dusk sky on it and the dusk fill on the surface, so
// it reads as dark water, not a black hole in the lawn (0 on the rail, uEye.z).
const float ROAM_SKY_MIRROR = 0.5;
const float ROAM_WATER_FILL = 0.25;
const float BANK_SOFT = 0.1;                          // share of the radius the wet bank fades over
const float BANK_WOBBLE = 0.08;
const float STREAK_AZ = 0.045;                        // radians: the moon column's half width
const float RIPPLE = 0.035;                           // slope of the slow ripples
const float RING_SLOPE = 0.06;                        // slope of the rings under the hand
const float RING_REACH = 1.4;                         // metres
const float REFL_STRENGTH = 0.6;
const float REFL_LEVEL = 0.1;                         // mirrored paper sits far under the lit paper
// The wake: a ring of small waves leaving the bank at WAKE_SPEED, a WAKE_WIDTH packet that flattens as it spreads.
const float WAKE_SPEED = 0.42;                        // metres per second
const float WAKE_LIFE = 3.6;                          // seconds
const float WAKE_WAVE = 34.0;                         // radians per metre: a wavelength of about 18 cm
const float WAKE_WIDTH = 0.16;                        // metres
const float WAKE_SLOPE = 0.14;
const float WAKE_SHEEN = 0.8;                         // the crests catch the low sky
// The pads: each breathes on its own slow swell and pushes a short train of rings off its rim.
const float PAD_SWELL = 0.55;                         // radians per second: a breath of about 11 s
const float PAD_SLOPE = 0.03;
const float PAD_SHEEN = 0.25;
const float PAD_RIM_DARK = 0.35;
// The lanterns on the water: a column at each flame's bearing from the eye, broken by the surface (elevation ignored,
// as the moon's). Lamp 0 is the carried lantern.
const float LAMP_COLUMN_WIDTH = 0.2;                  // metres across, at the flame's foot
const vec2 LAMP_COLUMN_SPAN = vec2(-1.2, 4.2);        // metres along it, from nearer the eye to past the flame's foot
const float LAMP_COLUMN_GAIN = 0.2;
const float LAMP_WOBBLE = 7.0;                        // metres of sideways drift per unit of surface slope
const float STAND_COLUMN_GAIN = 0.55;                 // standing lanterns, against the carried one
const float SHIMMER = 0.07;

// The clock of what this pass adds: held still under reduced motion.
float liveTime() { return uTime * (1.0 - uCalm); }

vec2 slowRipples(vec2 p) {
  float t = uTime * 0.25;
  vec2 a = vec2(valueNoise(p * 2.3 + vec2(t, 0.0)), valueNoise(p * 2.3 + vec2(5.2, -t)));
  vec2 b = vec2(valueNoise(p * 6.1 - vec2(0.0, t * 1.7)), valueNoise(p * 6.1 + vec2(t * 1.3, 2.9)));
  return (a - 0.5) * RIPPLE + (b - 0.5) * RIPPLE * 0.5;
}

vec2 handRings(vec2 p) {
  vec2 d = p - uCursor.xz;
  float r = length(d);
  float ring = sin(r * 22.0 - uTime * 3.2) * exp(-r * 2.4) * smoothstep(RING_REACH, 0.1, r);
  return d / max(r, 1e-3) * ring * RING_SLOPE;
}

// The wake's slope (xy) and how much crest there is (z).
vec3 wake(vec2 p) {
  vec3 s = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec4 w = uWake[i];
    float age = uTime - w.z;
    if (w.w <= 0.0 || age < 0.0 || age > WAKE_LIFE) continue;
    vec2 d = p - w.xy;
    float r = length(d);
    float front = age * WAKE_SPEED;
    float x = r - front;
    float packet = exp(-x * x / (WAKE_WIDTH * WAKE_WIDTH)) * sq(1.0 - age / WAKE_LIFE) * inversesqrt(1.0 + front * 6.0);
    float wave = sin(x * WAKE_WAVE) * packet * w.w;
    s += vec3(d / max(r, 1e-3) * wave * WAKE_SLOPE, max(wave, 0.0) * WAKE_SHEEN);
  }
  return s;
}

// The pads' rings: slope (xy), how near the nearest rim is (z, 1 on it) for the wet rim, and crest (w).
vec4 padRings(vec2 p) {
  vec4 acc = vec4(0.0);
  float t = liveTime();
  for (int i = 0; i < 6; i++) {
    if (i >= uPadCount) break;
    vec4 pad = uPads[i];
    vec2 d = p - pad.xy;
    float r = length(d);
    float x = r - pad.z;
    if (x < -0.05 || x > 0.8) continue;
    float swell = 0.6 + 0.4 * sin(t * PAD_SWELL + pad.w);
    float ring = sin(x * 30.0 - t * 1.4 + pad.w) * exp(-max(x, 0.0) * 5.0) * smoothstep(-0.02, 0.03, x);
    acc.xy += d / max(r, 1e-3) * ring * swell * PAD_SLOPE;
    acc.z = max(acc.z, exp(-max(x, 0.0) * 18.0) * smoothstep(-0.05, 0.0, x) * swell);
    acc.w += max(ring, 0.0) * swell * PAD_SHEEN;
  }
  return acc;
}

// Warm columns under the lanterns: at a flame's bearing from the eye, broken into dashes that drift with the surface.
vec3 lampColumns(vec2 p, vec2 slope) {
  vec2 cam = uCamPos.xz;
  float t = liveTime();
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec4 l = uLamp[i];
    if (l.w <= 0.0) continue;
    vec2 to = l.xz - cam;
    float dist = length(to);
    vec2 dir = to / max(dist, 1e-3);
    vec2 q = p - cam + slope * LAMP_WOBBLE;
    float along = dot(q, dir) - dist;
    if (along < LAMP_COLUMN_SPAN.x || along > LAMP_COLUMN_SPAN.y) continue;
    float across = q.x * dir.y - q.y * dir.x;
    float width = LAMP_COLUMN_WIDTH * (1.0 + 0.35 * abs(along));
    float column = exp(-across * across / (width * width))
      * smoothstep(LAMP_COLUMN_SPAN.x, 0.0, along) * (1.0 - smoothstep(0.3, LAMP_COLUMN_SPAN.y, along));
    float dashes = 0.3 + 0.7 * smoothstep(0.3, 0.8, valueNoise(vec2(along * 7.0 - t * 0.9, across * 6.0 + float(i) * 3.1)));
    acc += uLampColor * l.w * (i == 0 ? 1.0 : STAND_COLUMN_GAIN) * column * dashes;
  }
  return acc * LAMP_COLUMN_GAIN;
}

// The cutouts standing by the water, mirrored: a point on the water shows height y of an object at distance D when
// y = H (D / t - 1), with H the eye height and t the point's distance toward the object (camera ground distances).
vec4 reflections(vec2 p, vec2 slope) {
  vec2 cam = uCamPos.xz;
  float eye = max(uCamPos.y, 0.1);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uReflCount) break;
    vec4 r = uRefl[i];
    vec2 o = r.xy - cam;
    float dist = length(o);
    vec2 dir = o / max(dist, 1e-3);
    vec2 q = p - cam + slope * 3.0;
    float t = dot(q, dir);
    if (t <= 0.05 || t > dist) continue;
    float y = eye * (dist / t - 1.0);
    float side = abs(q.x * dir.y - q.y * dir.x) * dist / t;
    float body = smoothstep(r.w * 0.5, r.w * 0.05, side) * smoothstep(r.z, r.z * 0.4, y);
    // Vertical smear: broken into soft horizontal bands by the ripples, fading with height.
    body *= (0.65 + 0.35 * valueNoise(vec2(side * 6.0, y * 9.0 + uTime * 0.4))) * (1.0 - 0.5 * y / max(r.z, 1e-3));
    acc += vec4(uReflColour[i] * body, body);
  }
  return acc;
}

void main() {
  float rr = length(vLocal) * (1.0 + BANK_WOBBLE * (valueNoise(vLocal * 3.0 + uRect.xy) - 0.5));
  float water = smoothstep(1.0, 1.0 - BANK_SOFT, rr);
  if (water <= 0.0) discard;
  vec2 p = vWorld.xz;

  vec4 pads = padRings(p);
  vec3 stir = wake(p);
  vec2 slope = slowRipples(p) + handRings(p) + stir.xy + pads.xy;
  vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
  vec3 view = normalize(vWorld - uCamPos);
  vec3 refl = reflect(view, n);

  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(sat(refl.y / 0.5), 0.55));
  // A slow shimmer: the mirrored sky breathes in drifting patches, with a few fine glints on top.
  float ts = liveTime();
  float drift = valueNoise(p * 1.7 + vec2(ts * 0.11, -ts * 0.07));
  float glint = valueNoise(p * 11.0 + vec2(-ts * 0.3, ts * 0.21)) * valueNoise(p * 7.0 + slope * 40.0 - ts * 0.17);
  float shimmer = 1.0 + SHIMMER * ((drift - 0.5) * 2.0 + 4.0 * smoothstep(0.45, 0.8, glint));
  vec3 col = DEEP + neutralise(sky) * mix(SKY_MIRROR, ROAM_SKY_MIRROR, uEye.z) * (0.4 + 0.6 * pow(1.0 - sat(-view.y), 3.0)) * shimmer
    + neutralise(uAmbient) * ROAM_WATER_FILL * uEye.z
    + neutralise(uSkyHorizon) * SKY_MIRROR * (stir.z + pads.w);

  // The moon: a long column at its azimuth, its elevation ignored, broken into dashes by the ripples.
  float dAz = atan(refl.x, -refl.z) - atan(uMoonBack.x, -uMoonBack.z);
  float column = exp(-dAz * dAz / (STREAK_AZ * STREAK_AZ));
  float dashes = smoothstep(0.35, 0.75, valueNoise(vec2(p.x * 3.0, p.y * 14.0 - uTime * 0.5)));
  col += MOON_WATER * column * (0.1 + 0.4 * dashes) * smoothstep(0.0, 0.05, refl.y);

  vec4 mirrored = reflections(p, slope);
  col = mix(col, mirrored.rgb / max(mirrored.a, 1e-3) * REFL_LEVEL + DEEP, sat(mirrored.a) * REFL_STRENGTH);

  col += lampColumns(p, slope);

  // The hand light glints on the rings, small and warm.
  vec3 toHand = normalize(uCursor.xyz - vWorld);
  col += uCursorColor * pow(max(dot(refl, toHand), 0.0), 96.0) * handReach(vWorld) * 0.12;

  // The pads sit in the water: a darker wet rim right round each one.
  col *= 1.0 - PAD_RIM_DARK * pads.z;

  // Wet bank: the margin darkens toward the earth before it fades out.
  col *= mix(0.55, 1.0, smoothstep(1.0, 1.0 - BANK_SOFT * 2.0, rr));
  outColor = vec4(col * water, water);
}
