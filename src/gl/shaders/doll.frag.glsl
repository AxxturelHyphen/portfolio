// The burlap doll (src/gl/doll.ts), after common.glsl and lights.glsl, lit as the solids are (solid.frag.glsl): rough
// basket-woven burlap with slubs and loose fibres, cotton thread, bright steel and glossy black buttons that catch the
// lantern and the moon, the lantern's glass burning on its own, a soft contact shadow; pencil hatching where the
// light does not reach and a graphite edge where a face turns away, so the doll reads drawn like the garden round it.
uniform vec3 uCamPos;
uniform vec4 uHaze;

in vec3 vWorld;
in vec3 vNormal;
in vec3 vDepth;
in vec2 vFab;
flat in vec4 vPaint;
out vec4 outColor;

const float ROAM_HAZE_START = 7.0;
const float AMBIENT_GAIN = 1.6;
const float KNEE = 0.22;
const float CEIL = 0.36;
const float CARRIED = 0.35;      // the share of the carried lantern's light on the one who carries it
const float THREAD_M = 0.011;    // one burlap thread's pitch
const vec3 GRAPHITE = vec3(0.011, 0.010, 0.012);
const vec2 GRAZE = vec2(0.08, 0.5);
const float GRAZE_INK = 0.75;
const float HATCH_PER_M = 60.0;
const float TWIST = 4.0;         // turns of the thread's ply over one stitch
const vec2 HATCH_DARK = vec2(0.01, 0.06);

vec3 paperShoulder(vec3 c) {
  float m = max(max(c.r, c.g), max(c.b, 1e-4));
  float rolled = m < KNEE ? m : KNEE + (CEIL - KNEE) * (1.0 - exp(-(m - KNEE) / (CEIL - KNEE)));
  return c * (rolled / m);
}

// Basket weave: each crossing shows the thread on top, rounded across its width; it fades to its mean when too fine.
float weave(vec2 q) {
  vec2 c = floor(q);
  vec2 f = fract(q);
  float over = mod(c.x + c.y, 2.0);
  float w = mix(sin(f.y * 3.14159), sin(f.x * 3.14159), over);
  float fine = smoothstep(0.25, 0.6, max(fwidth(q.x), fwidth(q.y)));
  return mix(w, 0.64, fine);
}

void main() {
  int kind = int(vPaint.w + 0.5);
  if (kind == 5) {
    float a = 0.55 * (1.0 - smoothstep(0.25, 1.0, vFab.x));
    if (a < 0.01) discard;
    outColor = vec4(vPaint.rgb, a);
    return;
  }
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCamPos - vWorld);
  vec3 albedo = vPaint.rgb;
  if (kind == 0) {
    vec2 q = vFab / THREAD_M;
    float slub = valueNoise(vec2(vFab.x * 18.0, vFab.y * 140.0)) * valueNoise(vec2(vFab.x * 140.0, vFab.y * 18.0));
    albedo *= (0.62 + 0.55 * weave(q)) * (0.82 + 0.36 * fbm3(vFab * 60.0)) * (1.0 - 0.35 * slub);
  } else if (kind == 1) {
    // Thread (world/doll.sew.ts): vFab is the share along the stitch and round it. The ply twists round, darker in its
    // grooves (evened out when too fine to see), and the strand goes dark where it dips into the hole at each end.
    float ply = vFab.x * TWIST + vFab.y;
    float groove = mix(0.6 + 0.4 * sin(fract(ply) * 3.14159), 0.85, smoothstep(0.3, 0.7, fwidth(ply)));
    float hole = smoothstep(0.03, 0.17, min(vFab.x, 1.0 - vFab.x));
    albedo *= groove * (0.3 + 0.7 * hole) * (0.92 + 0.08 * valueNoise(vWorld.xy * 400.0));
  }
  vec3 night = nightOf(vWorld);
  vec3 ambient = neutralise(uAmbient) * AMBIENT_GAIN * mix(0.8, 1.25, n.y * 0.5 + 0.5) * (1.0 + 0.6 * fillAt(vDepth.x));
  vec3 key = neutralise(uMoonColor) * wrapLight(dot(n, uMoonDir), 0.4);
  vec3 rim = uRimColor * sq(max(dot(n, uMoonBack), 0.0)) * 2.0;
  vec3 hand = handLights(vWorld, n) + lampLightsGain(vWorld, n, CARRIED) + inviteLights(vWorld, n);
  vec3 lit = albedo * (ambient + key + rim) * night + keyLit(albedo, hand);
  // Steel and buttons: a sharp glint toward the flame and the moon.
  if (kind == 2 || kind == 3) {
    vec3 r = reflect(-v, n);
    vec3 toLamp = normalize(uLamp[0].xyz - vWorld);
    float gloss = kind == 3 ? 60.0 : 24.0;
    lit += uLampColor * pow(max(dot(r, toLamp), 0.0), gloss) * (kind == 3 ? 0.5 : 0.35) * step(0.0, uLamp[0].w)
      + uRimColor * pow(max(dot(r, normalize(uMoonDir + uMoonBack)), 0.0), gloss) * 0.6;
  }
  if (kind == 4) lit = vPaint.rgb * uLampColor * 0.45;
  lit = paperShoulder(lit);
  if (kind == 0) {
    float s = (vFab.x + vFab.y) * HATCH_PER_M;
    float line = 1.0 - smoothstep(0.2, 0.2 + fwidth(s) * 1.5, abs(fract(s) - 0.5));
    lit = mix(lit, GRAPHITE, 0.5 * line * (1.0 - smoothstep(HATCH_DARK.x, HATCH_DARK.y, luma(lit))));
  }
  float hazed = 1.0 - exp(-max(vDepth.x - ROAM_HAZE_START, 0.0) * uHaze.w);
  float back = uFocusBack.w * smoothstep(0.35, 1.6, vDepth.x - vDepth.z);
  lit = layerAir(mix(lit, neutralise(uHaze.rgb), hazed), vDepth.x - vDepth.y, back);
  if (kind != 4) lit = mix(lit, GRAPHITE, GRAZE_INK * (1.0 - smoothstep(GRAZE.x, GRAZE.y, abs(dot(n, v)))));
  outColor = vec4(lit, 1.0);
}
