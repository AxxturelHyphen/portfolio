// The intro mandala (cook/ART.md section 3.1), prepended to the film pass after common.glsl. Five motifs of the intro
// atlas page (gold acanthometra hub, rose, leaf spray, fan plume, swallow) are laid out in concentric rings of different
// symmetry counts, each ring a paper cutout layer with its own drop shadow, turning on held poses, alternate rings in
// opposite directions. Units are frame heights from the centre; the disc reaches 1.25 frame heights, so it bleeds past
// the top and bottom of the frame. Output is linear, premultiplied.
uniform sampler2D uKaleido; // the intro page (linear colour, straight alpha, bled colour under the clear texels)
uniform vec4 uKRect[5];     // uv rects of the motifs: hub, rose, leaf, plume, swallow (zero until the page is loaded)
uniform float uIntro;       // the intro channel 0..1; at 1 the iris shows its plain colour again

const float K_DISC = 0.625;                       // disc radius: 1.25 frame heights across
const vec3 K_DISC_INK = vec3(0.0091, 0.0080, 0.0343);   // #181634, the disc under the motifs
const vec3 K_GROUND_INK = vec3(0.0040, 0.0030, 0.0130); // #0d0a1e, the film ground outside it
const vec3 K_GLOW = vec3(0.604, 0.300, 0.120);    // warm halation round the gold hub, the "moon" of this shot
const float K_CHROMA = 1.5;                       // hand-tint at full strength: the page's washes pushed back to colour
const float K_SHADOW = 0.55;                      // cutout drop shadow opacity
const vec2 K_SHADOW_OFF = vec2(-0.035, 0.035);    // in sprite space: each piece lifts off the one below

vec4 motif(int i, vec2 st) {
  if (st.x < 0.0 || st.y < 0.0 || st.x > 1.0 || st.y > 1.0) return vec4(0.0);
  vec4 r = uKRect[i];
  return textureLod(uKaleido, mix(r.xy, r.zw, st), 0.0);
}

// One ring: `n` copies of motif `i` around radius `rc`, `len` along the radius and `wid` across it (frame heights).
// `tangent` lays the sprite's x along the circle instead of the radius; `quill` puts the sprite's right end at `rc`.
vec2 ringST(vec2 polar, float n, float rc, float len, float wid, float turn, bool tangent, bool quill) {
  float sector = 6.2831853 / n;
  float a = polar.y + turn;
  float da = a - floor(a / sector + 0.5) * sector;
  float u = polar.x * cos(da) - rc;
  float v = polar.x * sin(da);
  if (tangent) return vec2(-v / len + 0.5, u / wid + 0.5);
  if (quill) return vec2(1.0 - u / len, v / wid + 0.5);
  return vec2(u / len + 0.5, v / wid + 0.5);
}

vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }

vec4 layer(vec4 acc, int i, vec2 st) {
  float shadow = motif(i, st + K_SHADOW_OFF).a * K_SHADOW;
  acc = over(vec4(0.0, 0.0, 0.0, shadow), acc);
  vec4 m = motif(i, st);
  float y = luma(m.rgb);
  m.rgb = max(vec3(y) + (m.rgb - y) * K_CHROMA, 0.0) * m.a;
  return over(m, acc);
}

// The mandala at p (frame heights from the hub), on its held pose. Linear premultiplied over the film ground.
vec3 mandala(vec2 p, float pose) {
  float r = length(p);
  vec2 polar = vec2(r, atan(p.y, p.x));
  float step_ = pose * 0.04363;                   // 2.5 degrees per held pose (MOTION B2)
  float edge = K_DISC * (1.0 + 0.012 * (valueNoise(vec2(polar.y * 9.0, 3.1)) - 0.5));
  float inDisc = smoothstep(edge + 0.003, edge - 0.003, r);
  vec4 acc = vec4(0.0);
  if (uKRect[0].z > 0.0) {
    acc = layer(acc, 3, ringST(polar, 12.0, 0.15, 0.40, 0.125, step_ * 0.5, false, true));
    acc = layer(acc, 2, ringST(polar, 16.0, 0.30, 0.12, 0.08, -step_ * 0.7 + 0.196, true, false));
    acc = layer(acc, 1, ringST(polar, 14.0, 0.585, 0.13, 0.13, -step_ * 0.4, false, false));
    acc = layer(acc, 2, ringST(polar, 14.0, 0.57, 0.18, 0.12, -step_ * 0.4 + 0.2244, true, false));
    acc = layer(acc, 4, ringST(polar, 10.0, 0.47, 0.17, 0.087, step_, true, false));
    acc = layer(acc, 1, ringST(polar, 8.0, 0.215, 0.155, 0.155, -step_ * 0.8, false, false));
    acc = layer(acc, 0, ringST(polar, 1.0, 0.0, 0.33, 0.33, step_ * 0.3, false, false));
  }
  vec3 ground = mix(K_GROUND_INK, K_DISC_INK, inDisc) + K_GLOW * 0.05 * exp(-r / 0.2);
  return acc.rgb * inDisc + ground * (1.0 - acc.a * inDisc);
}
