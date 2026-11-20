// The one cutout material, fragment stage (common.glsl and lights.glsl are prepended). Lighting in linear space (the
// colour atlas is sampled as sRGB), output premultiplied. Light model: cook/ARCH.md 2.7 with the roles of lights.ts.
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform float uReveal;
uniform vec3 uShadow;      // drop shadow onto what is behind: uv offset per unit lift, softness (mip bias), strength
uniform vec4 uDepthFade;   // haze rgb, density per metre past HAZE_START
uniform vec4 uShadowDir;   // decal x, z, length per height, opacity
uniform float uDepthCut;   // fragments under this alpha are discarded: no depth from soft edges (0 on the rail)
uniform float uActorRim;   // the visitor's batch: a fuller moon rim so the figure reads as the protagonist (0 elsewhere)
uniform float uShadowPass; // 1 while drawing the lantern's shadow map: the silhouette alone, alpha tested
uniform float uTime;
uniform vec2 uBoil;        // x: the drawn line on (0 on the low tier), y: it boils (0 under reduced motion)

in vec2 vUV;
in vec4 vRect;
in vec3 vWorld;
in vec4 vTint;
in float vFade;
in float vSilhouette;
in vec4 vFrame;
in vec4 vOrient;
in float vLift;
in float vDecal;
in float vDepth;
in float vMirror;
in float vPlaneDepth;
in float vFocusDepth;
in float vHung;
in float vStone;
in vec4 vSide;
in vec3 vSideN;

out vec4 outColor;

const vec3 PAPER_BACK = vec3(0.184, 0.133, 0.067);   // acg-paper006 at #7b6648, linear
const float HAZE_START = 3.0;
const float ROAM_HAZE_START = 7.0;                   // free roam sees the wall from 13 m: its haze starts later
const float DECAL_SOFT_BIAS = 3.5;                    // alpha from about mip 3: 30 to 70 px soft
const float DECAL_COVERAGE = 3.0;                     // sparse plants still cast a readable patch
const float CONTACT = 0.55;                           // the darker line where the paper meets the ground
const vec2 FOOT_AO = vec2(0.4, 0.14);                 // free roam: occlusion round the foot, depth and reach (share of the decal)
const float EDGE_LIGHT = 0.55;
const float EDGE_DARK = 0.38;
const vec3 PAPER_RIM = vec3(0.815, 0.716, 0.597);    // #e9dccb pale paper edge, linear
const float PAPER_RIM_STRENGTH = 0.4;
const float TINT_FLOOR = 0.65;                        // shaded layers darken by 35 % at most
const float ROAM_TINT_FLOOR = 0.5;                    // free roam's dusk lets a pale plate (the peacock, the cards) sink further
const float SHADED_FROM = 0.75;                       // tints darker than this luma count as a shaded layer
const float SILHOUETTE_HAZE = 0.3;                    // how far a shaded layer turns toward the haze hue
const vec3 COOL_RIM = vec3(0.30, 0.36, 0.46);         // moonlit rim on the shaded layers
const float AMBIENT_GAIN = 1.6;                       // the moonlit dusk fill: midground paper reads, blacks stay
const float LEAF_MIP_BIAS = 3.0;                      // the leaf weight reads the plate at about 8 px
// Lit paper keeps its hue: the brightest channel rolls off from KNEE toward CEIL (linear), the others follow it, so a
// lit crimson stays crimson instead of washing to coral and no paper passes about luma 215 after the grade.
const float KNEE = 0.22;
const float CEIL = 0.36;
// Cool moon rim on the moon-facing edge: a band about RIM_PX wide from cool moon white at the edge into slate shade,
// strongest on dark forms (cook/SHOTS.md: rim band 10 to 20 px; #d6dbe6 at the edge, #5c6478 inside).
const float RIM_PX = 10.0;
const float RIM_SOFT_BIAS = 1.0;
const vec3 RIM_MOON = vec3(0.672, 0.708, 0.791);
const vec3 RIM_SHADE = vec3(0.107, 0.127, 0.181);
const float RIM_STRENGTH = 0.22;
// Free roam sees the plates from a metre or two: a 10 px band reads as a halo there, so the rim is a thin sharp line.
const float ROAM_RIM_PX = 2.5;
const float ROAM_RIM_STRENGTH = 0.12;
const float ACTOR_RIM_WIDEN = 4.0;                    // the visitor's rim widens by this share of uActorRim
const float RIM_DARK_LUMA = 0.08;                     // forms darker than this take the full rim
// Behind a focused flower (or a bed's flowers at rest) the far layers fall back: softer (mip bias, never under free roam,
// where the walker sees the plates up close) and darker.
const vec2 FOCUS_BACK = vec2(0.35, 1.6);              // metres behind the flower where the fall-off starts and is full
const float FOCUS_BLUR = 3.0;
// Under free roam no paper goes black: away from every light the darkest plates (a cart's wheels, the hedge beyond the
// wall, a dark poppy) settle on a dusk floor in their own hue, near-black plates in the dusk air's hue, so they keep
// their tint and grain. Paper above the knee is untouched; the rail never takes it (uEye.z).
const float ROAM_FLOOR = 0.014;                       // linear luma the blackest paper lifts to
const float ROAM_FLOOR_KNEE = 0.035;
const vec2 ROAM_FLOOR_HUE = vec2(0.002, 0.03);        // plate luma where its own hue starts to lead and leads fully
const float ROAM_FLOOR_HUE_KEPT = 0.7;
const vec2 ROAM_FLOOR_GRAIN = vec2(0.7, 1.5);         // the plate's fine detail against its coarse mip, kept in the floor

vec3 paperShoulder(vec3 c) {
  float m = max(max(c.r, c.g), max(c.b, 1e-4));
  float rolled = m < KNEE ? m : KNEE + (CEIL - KNEE) * (1.0 - exp(-(m - KNEE) / (CEIL - KNEE)));
  return c * (rolled / m);
}

float rectAlpha(vec2 uv, float bias) {
  vec2 inside = step(vRect.xy, uv) * step(uv, vRect.zw);
  return texture(uColor, uv, bias).a * inside.x * inside.y;
}

// Alpha beside a pixel for the paper edge: past the sprite's rect it repeats `here`, so tiles get no seam line.
float edgeAlpha(vec2 uv, float here) {
  vec2 inside = step(vRect.xy, uv) * step(uv, vRect.zw);
  return inside.x * inside.y > 0.5 ? texture(uColor, uv, 0.0).a : here;
}

// Soft alpha beside a pixel for the moon rim (sharp under free roam); past the sprite's rect it repeats `here`.
float rimAlpha(vec2 uv, float here) {
  vec2 inside = step(vRect.xy, uv) * step(uv, vRect.zw);
  return inside.x * inside.y > 0.5 ? texture(uColor, uv, RIM_SOFT_BIAS * (1.0 - uEye.z)).a : here;
}

// Scissor-cut paper under free roam: where a plate is magnified its linear alpha ramp spans a whole texel, so the
// edge is squeezed back to about one pixel, cut a little inside the matte (CUT) where the paper's own fringe sits.
// Minified plates keep their filtered alpha, so thin stems never break up.
const float CUT = 0.55;
float crispAlpha(float a) {
  float texels = length(fwidth(vUV)) * float(textureSize(uColor, 0).x);
  float cut = sat((a - CUT) / max(fwidth(a), 1e-4) + 0.5);
  return mix(a, cut, uEye.z * sat(1.5 - texels));
}
// The plates' cut edges still hold a trace of the page they were cut from, a pale line one or two texels wide: under
// free roam it is toned down to the paper's own value, so a cutout ends in its own colour, not a halo.
const vec2 FRINGE = vec2(0.5, 0.97);                  // raw alpha where the toning is full and where it ends
const float FRINGE_TONE = 0.78;
float fringeTone(float a) { return mix(1.0, mix(FRINGE_TONE, 1.0, smoothstep(FRINGE.x, FRINGE.y, a)), uEye.z); }

// Direction in the sprite's uv frame of a world-space xy direction (undoes rotation and flip).
vec2 toSpriteUV(vec2 d) {
  vec2 local = vec2(vFrame.x * d.x + vFrame.y * d.y, -vFrame.y * d.x + vFrame.x * d.y);
  local.x *= vFrame.z;
  return normalize(local + vec2(1e-4, 0.0));
}

const float CUTOUT_FILL = 0.6;                        // the near fill on paper, as a share of its ambient
// A hung lantern is lit from inside: its pale parts (glass, pierced light) glow warm, strongest round the flame, its
// dark frame stays dark, and the side toward the lens takes the most of it.
const vec2 GLOW_FLAME = vec2(0.4, 0.3);               // the flame's height in the plate and the glow's spread
const float GLOW = 0.13;
const float FRAME_DARK = 0.35;
const float HUNG_OPACITY = 0.95;                       // the soft shadow straight below a hanging cutout
// The flame's heart is past the paper's shoulder: a warm near-white core the clamp would flatten to yellow.
const vec3 FLAME_CORE = vec3(1.0, 0.8, 0.52);
const vec2 FLAME_CORE_FROM = vec2(0.5, 0.92);         // share of the core glow where the white starts and is full

// Paper thickness (free roam, not on the low tier): through a pixel the face leaves open, the eye's ray goes on behind
// the face across the card's thickness (vSide.w); the first of SIDE_TAPS taps inside the silhouette is the cut edge,
// warm off-white, darker toward the back. Taps past the sprite's rect see no paper; a pixel past the rect beside a tile
// that runs to its rect (wall, coping) takes no edge, so tiled flats never show one at their seams.
const float SIDE_TAPS = 4.0;
const float SIDE_SLOPE = 1.2;                         // THICK_PAD of the vertex stage: the room the grown quad leaves
const vec3 PAPER_EDGE = vec3(0.55, 0.47, 0.35);       // #c4b6a0 warm off-white card core, linear
const float EDGE_BACK = 0.4;                          // the share of light the edge keeps at the back face
const float EDGE_AMBIENT = 0.7;                       // the dusk fill on the edge: dimmer than on the face
const float EDGE_LAMP = 0.6;                          // the lanterns graze the edge
const vec2 EDGE_FIBRE = vec2(0.82, 0.6);              // the fibre grain: darkest share, texels per grain
const vec2 FOOT_SHADE = vec2(0.14, 0.4);              // free roam: occlusion on standing paper near the ground: height (m), depth
const float EDGE_RIM = 1.4;                           // the moon grazing the cut edges that face it (tops, coping)

// Stone relief under free roam (not on the low tier): the courses stand out of their mortar. A texel's height is its
// luma against the tile's local mean (joints dark, faces pale); stepping along the eye's ray into the wall finds the
// face it meets first, so at the orbit's angles the joints sink behind the stones' edges.
const float RELIEF = 0.04;                            // metres from a stone's face down to the mortar
const float RELIEF_TAPS = 8.0;
const vec2 RELIEF_LUMA = vec2(0.45, 1.2);             // luma over the local mean of the deepest joint and of a face
const float RELIEF_SHADE = 0.55;                      // the light the deepest joint keeps
float stoneHeight(vec2 uv, float mean) { return smoothstep(RELIEF_LUMA.x, RELIEF_LUMA.y, luma(texture(uColor, uv, 1.0).rgb) / mean); }

// The line breathes: near the silhouette the plate is redrawn on twelves, a cycle of BOIL_POSES poses, each pushing
// the cut edge (and the paper edge behind it) up to BOIL_PX on screen along a low-frequency noise fixed to the plate.
const float BOIL_FPS = 12.0;
const float BOIL_POSES = 3.0;
const float BOIL_PX = 1.5;
const float BOIL_TEXELS = 32.0;                       // texels per wobble cell
const float BOIL_BAND_BIAS = 3.0;                     // the band near the edge that moves, from about mip 3 of the alpha
// A pencil contour about a pixel wide just inside the cut, of varying pressure and broken in places. Its gaps hold
// still; only its pressure is redrawn with each pose, so it reads drawn without flickering.
const vec2 INK_PX = vec2(0.9, 1.7);                   // pixels inside the cut where the line is full and where it ends
const float INK_TEXELS = 12.0;
const vec2 INK_BREAK = vec2(0.3, 0.48);               // noise where a gap closes and where the line is whole
const float INK_PRESSURE = 0.45;                      // the lightest stroke as a share of the darkest
const float INK = 0.75;
const vec3 GRAPHITE = vec3(0.011, 0.010, 0.012);      // #1b1a1c soft pencil, linear

float boilPose() { return mod(floor(uTime * BOIL_FPS), BOIL_POSES) * uBoil.y; }

vec2 boilOffset(float pose) {
  vec2 p = vUV * vec2(textureSize(uColor, 0)) / BOIL_TEXELS + pose * vec2(7.31, 3.17);
  vec2 wobble = vec2(valueNoise(p), valueNoise(p + 19.7)) * 2.0 - 1.0;
  float band = 1.0 - sq(2.0 * texture(uColor, vUV, BOIL_BAND_BIAS).a - 1.0);
  return wobble * BOIL_PX * fwidth(vUV) * band * uBoil.x;
}

// How much pencil this pixel takes: `a` is the plate's alpha before the rect clip, so tiles never ink their seams.
float inkOf(float a, float pose) {
  float inside = (a - CUT) / max(fwidth(a), 1e-4);
  vec2 p = vUV * vec2(textureSize(uColor, 0)) / INK_TEXELS;
  float pressure = mix(INK_PRESSURE, 1.0, valueNoise(p + pose * vec2(5.3, 11.1)));
  float whole = smoothstep(INK_BREAK.x, INK_BREAK.y, valueNoise(p * 0.37 + 41.0));
  return (1.0 - smoothstep(INK_PX.x, INK_PX.y, inside)) * pressure * whole * INK * uBoil.x;
}

float inRect(vec2 uv) {
  vec2 inside = step(vRect.xy, uv) * step(uv, vRect.zw);
  return inside.x * inside.y;
}

// x: how much of the cut edge this pixel sees, y: how deep the edge seen lies, 0 at the face and 1 at the back.
vec2 paperSide(vec2 boil) {
  float reach = vSide.w * min(1.0 / max(abs(vSide.z), 1e-4), SIDE_SLOPE / max(length(vSideN), 1e-4));
  vec2 stride = -vSide.xy * reach / SIDE_TAPS;
  float hit = 0.0;
  float depth = 0.0;
  for (float i = 1.0; i <= SIDE_TAPS; i++) {
    vec2 uv = vUV + boil + stride * i;
    float a = smoothstep(0.3, 0.7, texture(uColor, uv, 0.0).a) * inRect(uv) * (1.0 - hit);
    depth += a * i / SIDE_TAPS;
    hit += a;
  }
  float tile = (1.0 - inRect(vUV)) * texture(uColor, clamp(vUV, vRect.xy, vRect.zw), 0.0).a;
  return vec2(hit * (1.0 - tile), depth / max(hit, 1e-4));
}

vec4 decal() {
  if (vFrame.w < -0.5) {
    vec2 e = (vUV - vRect.xy) / max(vRect.zw - vRect.xy, vec2(1e-5)) * 2.0 - 1.0;
    float op = HUNG_OPACITY * sq(sat(1.0 - dot(e, e))) * vTint.a * uReveal;
    return vec4(neutralise(uShadowColor) * 0.5 * op, op);
  }
  vec2 size = vRect.zw - vRect.xy;
  float spread = size.x * (0.04 + 0.1 * vDecal);
  float a = 0.25 * (rectAlpha(vUV + vec2(-spread, 0.0), DECAL_SOFT_BIAS) + rectAlpha(vUV + vec2(spread, 0.0), DECAL_SOFT_BIAS)
    + rectAlpha(vUV + vec2(0.0, -spread), DECAL_SOFT_BIAS) + rectAlpha(vUV + vec2(0.0, spread), DECAL_SOFT_BIAS));
  float foot = rectAlpha(vec2(vUV.x, vRect.y + size.y * 0.02), 1.0 + uEye.z);
  float contact = foot * (CONTACT * (1.0 - smoothstep(0.0, 0.06, abs(vDecal))) + FOOT_AO.x * uEye.z * exp(-sq(vDecal / FOOT_AO.y)));
  float op = (uShadowDir.w * sat(a * DECAL_COVERAGE) * pow(1.0 - vDecal, 1.4) + contact) * vTint.a * uReveal;
  return vec4(neutralise(uShadowColor) * 0.5 * op, op);
}

void main() {
  if (uShadowPass > 0.5) {
    if (texture(uColor, vUV).a * inRect(vUV) < 0.5) discard;
    outColor = vec4(0.0);
    return;
  }
  if (vFrame.w < 0.5) {
    outColor = decal();
    if (outColor.a < uDepthCut) discard;
    return;
  }
  float back = uFocusBack.w * smoothstep(FOCUS_BACK.x, FOCUS_BACK.y, vDepth - vFocusDepth);
  float blur = back * FOCUS_BLUR * (1.0 - uEye.z);
  // The colour softens behind the focus; the alpha stays sharp so tiled flats never open a seam.
  // A quad grown for the paper edge shows its face and its drop shadow only inside the sprite's rect.
  float rect = vSide.w > 0.0 ? inRect(vUV) : 1.0;
  float pose = boilPose();
  vec2 boil = boilOffset(pose);
  vec2 uv = clamp(vUV + boil, vRect.xy, vRect.zw);
  float plateA = texture(uColor, uv).a;
  float rawA = plateA * rect;
  float relief = 1.0;
  if (vStone * vSide.w > 0.0) {
    float mean = max(luma(texture(uColor, vUV, 6.0).rgb), 1e-3);
    vec2 stride = -vSide.xy / max(vSide.z, 0.1) * RELIEF / RELIEF_TAPS;
    for (float i = 0.0; i < RELIEF_TAPS; i++) {
      relief = stoneHeight(uv, mean);
      if (i / RELIEF_TAPS >= 1.0 - relief) break;
      uv += stride;
    }
    relief = mix(RELIEF_SHADE, 1.0, relief);
  }
  vec4 tex = vec4(texture(uColor, uv, blur).rgb * relief * fringeTone(rawA), crispAlpha(rawA));
  vec2 nxy = texture(uNormal, uv, blur).xy * 2.0 - 1.0;
  nxy.x *= vFrame.z * (vMirror > 0.5 ? -1.0 : 1.0);
  nxy = vec2(vFrame.x * nxy.x - vFrame.y * nxy.y, vFrame.y * nxy.x + vFrame.x * nxy.y);
  vec3 n = vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.05)));
  // Shaded layers keep their plate: the place tint is capped and turned toward the haze hue, not a brown multiply.
  float shaded = sat((SHADED_FROM - luma(vTint.rgb)) / (SHADED_FROM - TINT_FLOOR)) * (1.0 - vSilhouette);
  vec3 albedo = tex.rgb * max(vTint.rgb, vec3(mix(TINT_FLOOR, ROAM_TINT_FLOOR, uEye.z) * (1.0 - vSilhouette)));
  vec3 haze = neutralise(uDepthFade.rgb);
  vec3 hazeHue = mix(vec3(1.0), haze / max(luma(haze), 1e-3), 0.5);
  albedo = mix(albedo, luma(albedo) * hazeHue, shaded * SILHOUETTE_HAZE);
  // A cutout mirrored by a negative width has its winding reversed: its plate face is the geometric back.
  if (gl_FrontFacing == (vMirror > 0.5)) {
    albedo = PAPER_BACK;
    n = vec3(-nxy.x, nxy.y, n.z) * 0.4 + vec3(0.0, 0.0, 0.6);
  }
  // Quad frame to world: lean back (tilts the face up), then yaw; flat cutouts face the sky.
  float cl = cos(vOrient.z);
  float sl = sin(vOrient.z);
  n = vec3(n.x, n.y * cl + n.z * sl, n.z * cl - n.y * sl);
  n = vOrient.w > 0.5 ? vec3(n.x, n.z, -n.y) : n;
  n = normalize(vec3(n.x * vOrient.x + n.z * vOrient.y, n.y, -n.x * vOrient.y + n.z * vOrient.x));

  vec3 ambient = neutralise(uAmbient) * AMBIENT_GAIN * mix(0.8, 1.25, n.y * 0.5 + 0.5) * (1.0 + CUTOUT_FILL * fillAt(vDepth));
  vec3 key = neutralise(uMoonColor) * wrapLight(dot(n, uMoonDir), 0.4);
  vec3 rim = uRimColor * sq(max(dot(n, uMoonBack), 0.0)) * 2.0;
  vec3 hand = handLights(vWorld, n) + lampLights(vWorld, n) + inviteLights(vWorld, n);
  vec3 night = nightOf(vWorld);
  ambient *= night;
  key *= night;
  rim *= night;
  // Leaf weight from a coarse mip of the plate, so block noise in a pale leaf never flips it on and off. Mossy stone
  // sits on the leaf threshold, where its coarse blocks would flip between amber and teal: stone is never a leaf.
  vec3 coarse = texture(uColor, vUV, LEAF_MIP_BIAS).rgb;
  float leaf = leafWeight(coarse) * (1.0 - vStone);
  vec3 lit = paperShoulder(albedo * (ambient + key + rim) + leafKeyLit(albedo, hand, leaf));
  float foot = 1.0 - FOOT_SHADE.y * uEye.z * (1.0 - vOrient.w) * (1.0 - smoothstep(0.0, FOOT_SHADE.x, vWorld.y));
  vec2 side = vSide.w > 0.0 && tex.a < 0.99 ? paperSide(boil) : vec2(0.0);
  vec3 sideLit = vec3(0.0);
  if (side.x > 1e-3) {
    vec3 sn = normalize(vSideN + vec3(0.0, 1e-4, 0.0));
    vec3 sideLight = (neutralise(uAmbient) * EDGE_AMBIENT + neutralise(uMoonColor) * wrapLight(dot(sn, uMoonDir), 0.2)) * night
      + uRimColor * EDGE_RIM * sq(sq(max(dot(sn, uMoonDir), 0.0))) * night + (handLights(vWorld, sn) + lampLights(vWorld, sn)) * EDGE_LAMP;
    float fibre = mix(EDGE_FIBRE.x, 1.0, valueNoise(vUV * vec2(textureSize(uColor, 0)) / EDGE_FIBRE.y));
    sideLit = paperShoulder(PAPER_EDGE * mix(1.0, EDGE_BACK, side.y) * fibre * sideLight) * foot;
  }
  lit *= foot;
  if (vHung > 0.5) {
    vec2 q = (vUV - vRect.xy) / max(vRect.zw - vRect.xy, vec2(1e-5));
    float core = exp(-sq((q.y - GLOW_FLAME.x) / GLOW_FLAME.y) - sq((q.x - 0.5) / 0.4));
    float glass = smoothstep(0.02, 0.12, luma(tex.rgb)) * (0.25 + 0.75 * core);
    vec3 glow = uLampColor * GLOW * (0.35 + core) * mix(vec3(1.0), albedo / max(luma(albedo), 1e-3), 0.3);
    lit = paperShoulder(mix(albedo * (ambient + key) * FRAME_DARK, glow, glass) + albedo * hand * 0.15 * (1.0 - glass));
    lit = mix(lit, FLAME_CORE, smoothstep(FLAME_CORE_FROM.x, FLAME_CORE_FROM.y, core) * glass * min(luma(uLampColor), 1.0));
  }

  // The light that moves the edges and shadows: the hand where it reaches, else the key.
  float reach = handReach(vWorld);
  vec2 lightXY = mix(uMoonDir.xy, normalize(uCursor.xy - vWorld.xy + vec2(1e-4, 0.0)), sat(reach * 3.0));
  vec2 lightUV = toSpriteUV(lightXY);

  // Lifted paper edge: a thin lighter rim facing the light, a darker one on the far side (1.5 px on screen).
  float ew = 1.5 * length(fwidth(vUV));
  float towardLight = 1.0 - edgeAlpha(vUV + lightUV * ew, tex.a);
  float awayLight = 1.0 - edgeAlpha(vUV - lightUV * ew, tex.a);
  float edgeGain = luma(key + hand) * 2.0 + 0.05;
  lit += albedo * towardLight * EDGE_LIGHT * edgeGain;
  // The pale paper edge shows only where the hand light falls; shaded layers get the cool moon rim instead.
  lit += towardLight * mix(PAPER_RIM * PAPER_RIM_STRENGTH * sat(reach * 2.0), COOL_RIM * 0.3, shaded);
  lit *= 1.0 - EDGE_DARK * awayLight;

  float hazed = 1.0 - exp(-max(vDepth - mix(HAZE_START, ROAM_HAZE_START, uEye.z), 0.0) * uDepthFade.w);
  lit = mix(lit, haze, hazed);
  lit = layerAir(lit, vDepth - vPlaneDepth, back);
  sideLit = layerAir(mix(sideLit, haze, hazed), vDepth - vPlaneDepth, back);
  vec3 plate = coarse * max(vTint.rgb, vec3(ROAM_TINT_FLOOR));
  float plateLuma = luma(plate);
  vec3 floorHue = mix(hazeHue, plate / max(plateLuma, 1e-3), smoothstep(ROAM_FLOOR_HUE.x, ROAM_FLOOR_HUE.y, plateLuma) * ROAM_FLOOR_HUE_KEPT);
  float grain = clamp(luma(tex.rgb) / max(luma(coarse), 1e-4), ROAM_FLOOR_GRAIN.x, ROAM_FLOOR_GRAIN.y);
  lit += floorHue * ROAM_FLOOR * grain * uEye.z * (1.0 - smoothstep(0.0, ROAM_FLOOR_KNEE, luma(lit)));

  // Moon rim, after the air so the haze cannot eat it: inside the paper, where the soft alpha toward the moon runs out
  // (two taps make the gradient). Thin moon white at the very edge into cool shade, only on the moon side.
  vec2 moonUV = toSpriteUV(uMoonBack.xy + vec2(0.0, 0.2));
  float rw = mix(RIM_PX, ROAM_RIM_PX, uEye.z) * (1.0 + ACTOR_RIM_WIDEN * uActorRim) * length(fwidth(vUV));
  float edgeNear = 1.0 - rimAlpha(vUV + moonUV * rw * 0.4, tex.a);
  float edgeFar = 1.0 - rimAlpha(vUV + moonUV * rw, tex.a);
  // Thin stems and blades are open on the far side too: they take a trace of the rim, not a white outline.
  float thin = 1.0 - rimAlpha(vUV - moonUV * rw, tex.a);
  float rimBand = sat(0.7 * edgeNear + 0.3 * edgeFar) * (1.0 - shaded * 0.3) * (1.0 - 0.85 * thin);
  float dark = 1.0 - smoothstep(0.0, RIM_DARK_LUMA, luma(lit));
  lit += mix(RIM_SHADE, RIM_MOON, edgeNear) * rimBand * (mix(RIM_STRENGTH, ROAM_RIM_STRENGTH, uEye.z) * (0.3 + 0.7 * dark) + uActorRim) * (1.0 - back) * (1.0 - 0.6 * hazed);
  lit = mix(lit, GRAPHITE, inkOf(plateA, pose) * (1.0 - hazed) * (1.0 - 0.7 * back));

  // Drop shadow onto the paper behind: the sprite's alpha pushed away from the light, inside its gutter.
  float shadow = rectAlpha(vUV - lightUV * uShadow.x * vLift, uShadow.y) * uShadow.z * sat(vLift * 4.0) * (0.6 + 0.4 * reach) * rect;

  float opacity = vTint.a * uReveal * vFade;
  float a = tex.a * opacity;
  float sideA = side.x * opacity * (1.0 - a);
  float shadowA = shadow * opacity * (1.0 - a) * (1.0 - side.x);
  outColor = vec4(lit * a + sideLit * sideA + neutralise(uShadowColor) * 0.4 * shadowA, a + sideA + shadowA);
  if (outColor.a < uDepthCut) discard;
}
