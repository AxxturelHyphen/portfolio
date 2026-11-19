// The still pond (common.glsl and lights.glsl prepended): dark water that mirrors the sky, the moon as a long broken
// column, slow ripples, rings under the hand light, a soft wet bank and the nearby cutouts as vertical smears.
// Linear colour, premultiplied output.
uniform vec3 uCamPos;
uniform float uTime;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec4 uRect;
uniform vec4 uRefl[8];       // foot x, z, height, width
uniform vec3 uReflColour[8]; // linear plate colour
uniform int uReflCount;

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

  vec2 slope = slowRipples(p) + handRings(p);
  vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
  vec3 view = normalize(vWorld - uCamPos);
  vec3 refl = reflect(view, n);

  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(sat(refl.y / 0.5), 0.55));
  vec3 col = DEEP + neutralise(sky) * mix(SKY_MIRROR, ROAM_SKY_MIRROR, uEye.z) * (0.4 + 0.6 * pow(1.0 - sat(-view.y), 3.0))
    + neutralise(uAmbient) * ROAM_WATER_FILL * uEye.z;

  // The moon: a long column at its azimuth, its elevation ignored, broken into dashes by the ripples.
  float dAz = atan(refl.x, -refl.z) - atan(uMoonBack.x, -uMoonBack.z);
  float column = exp(-dAz * dAz / (STREAK_AZ * STREAK_AZ));
  float dashes = smoothstep(0.35, 0.75, valueNoise(vec2(p.x * 3.0, p.y * 14.0 - uTime * 0.5)));
  col += MOON_WATER * column * (0.1 + 0.4 * dashes) * smoothstep(0.0, 0.05, refl.y);

  vec4 mirrored = reflections(p, slope);
  col = mix(col, mirrored.rgb / max(mirrored.a, 1e-3) * REFL_LEVEL + DEEP, sat(mirrored.a) * REFL_STRENGTH);

  // The hand light glints on the rings, small and warm.
  vec3 toHand = normalize(uCursor.xyz - vWorld);
  col += uCursorColor * pow(max(dot(refl, toHand), 0.0), 96.0) * handReach(vWorld) * 0.12;

  // Wet bank: the margin darkens toward the earth before it fades out.
  col *= mix(0.55, 1.0, smoothstep(1.0, 1.0 - BANK_SOFT * 2.0, rr));
  outColor = vec4(col * water, water);
}
