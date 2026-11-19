// Ground (common.glsl and lights.glsl prepended): earth with a value ramp toward the wall, moss at the wall foot and in
// the joints, a flagstone path from the baked distance field, puddles that mirror the sky, the moon glint and the hand
// light with a ripple under the cursor, and an engraver's line screen so the photo stone reads as print. Linear output.
uniform vec4 uBounds;          // x0, z0, x1, z1
uniform sampler2D uPath;       // distance to the path centre, 0..1 = 0..uPathRange metres
uniform float uPathRange;
uniform sampler2D uStone;      // photo stone (plate pass reads its luminance)
uniform sampler2D uStoneN;     // its normal map
uniform float uStoneOn;
uniform vec4 uPuddle[12];      // x, z, radius x, radius z
uniform int uPuddles;
uniform vec3 uCamPos;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uMoonBody;
uniform vec4 uHaze;
uniform float uTime;

in vec3 vWorld;
in float vDepth;
out vec4 outColor;

const vec3 EARTH = vec3(0.031, 0.025, 0.012);        // #312c1c bare earth
const vec3 MOSS_FLOOR = vec3(0.025, 0.042, 0.034);   // #2c3a33 moss patches, 1.5 to 3 m across
// Free roam only: worked soil in the beds and along both path edges, and a drier second lawn tone in broad drifts, so
// the ground reads as a planted garden rather than one felt.
const vec3 SOIL = vec3(0.036, 0.024, 0.013);          // #352a1e dark loam
const vec2 SOIL_EDGE = vec2(0.95, 0.3);               // soil from the path edge out to this distance from the centre, its wobble
const vec2 SOIL_BEDS = vec2(-0.9, -1.7);              // z where the beds' soil starts and is full, north of the path
const float SOIL_SHARE = 0.85;
const vec3 LAWN_DRY = vec3(1.35, 1.0, 0.55);          // the drier lawn tone: toward straw at the same value
const float LAWN_DRY_SCALE = 0.32;
const float ROAM_FILL_GREY = 0.6;                     // share of the near fill's cool cast taken out under roam
// Free roam walks on the near lawn the rail keeps dark to frame its beds: there the lawn is an olive grass green over
// warm earth, darkened toward the lens only to ROAM_NEAR_DIM, and the near fill lights the ground's own colours
// (ROAM_FILL_LIT times its albedo) instead of laying the ambient's grey over them.
const vec3 ROAM_LAWN = vec3(0.033, 0.037, 0.019);     // #333725 a muted olive lawn
const float ROAM_NEAR_DIM = 0.55;
const float ROAM_FILL_LIT = 10.0;
const float PATCH_SCALE = 0.45;                       // fbm frequency per metre
const float PATCH_CONTRAST = 0.25;
uniform float uWallZ;                                 // content/garden.json ground.wall.z
uniform vec4 uEnclose;                                // free roam: the closed garden x0, z0, x1, z1; x1 < x0 on the rail
const vec3 HEDGE_FOOT = vec3(0.008, 0.017, 0.013);    // #22352e in deep shade: the ground beyond the walls
const float WALL_FADE = 0.4;                          // soft dark join where the ground meets the wall
const vec3 POOL_SHAPE = vec3(0.35, 1.5, 0.75);        // the hand's throw: shift into the scene, length, width (radii)
const float POOL = 0.45;
const float POOL_GREY = 0.8;
const float LAMP_CEIL = 0.26;                         // linear luma the lantern pools on the ground roll off toward
const float CARRIED_POOL = 1.35;                      // the carried lantern's pool leads every other light on the ground
const float LAMP_GREEN_FADE = 0.8;                    // how far the moss under a lantern pool loses its green
const float LAMP_GRAIN = 0.35;
const float LAMP_LAWN = 0.08;                         // the darkest value a lantern sees on the lawn: light on grass, no smudge
const float GROUND_FILL = 0.4;                        // the near fill on the ground, as a share of the place ambient                        // how much the ground's own grain breaks up a lantern pool
uniform float uHandThrow;                             // 0 until a pointer arrives: a hand at rest throws no pool
const vec3 STONE = vec3(0.060, 0.055, 0.052);
const vec3 MOSS_SHADE = vec3(0.016, 0.054, 0.028);   // #21422f
const vec3 MOSS_MID = vec3(0.044, 0.118, 0.073);     // #3b614c
const vec3 GRASS = vec3(0.010, 0.026, 0.014);
const float HALF_WIDTH = 0.55;                        // a 1.1 m path
const float CELL = 0.42;                              // flagstone size
const float PITCH = 0.012;                            // line screen on the ground: 12 mm
const float LINE_CONTRAST = 0.22;
const float GLINT_AZ = 0.1047;                        // 6 degrees
const float GLINT = 0.16;                             // the moon streak in a puddle, broken into dashes
const float WET_CEILING = 0.3;                        // nothing in the water above display luma about 150
const float HAZE_START = 3.0;
const float ROAM_HAZE_START = 7.0;                   // free roam sees the wall from 13 m: its haze starts later
const float FIELDS_DEPTH = 34.0;                     // metres past the wall where the fields meet the horizon sky
const float FIELDS_NEAR = 0.22;                       // share of the horizon sky in the near fields (a dusk silhouette)
const float FIELDS_FAR = 0.6;
const float FIELDS_CHROMA = 0.45;                     // the fields keep under half the sky's hue: land, not water
const float GROUND_ALBEDO = 3.2;                     // night ramp to what the warm lights see (keeps the texture)

// Voronoi: x = distance to the nearest centre, y = distance to the border (F2 - F1 style), zw = nearest cell id.
vec4 voronoi(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  float d1 = 8.0, d2 = 8.0;
  vec2 id = vec2(0.0), c1 = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = g + 0.15 + 0.7 * hash22(i + g) - f;
      float d = dot(o, o);
      if (d < d1) { d2 = d1; d1 = d; id = i + g; c1 = o; }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec4(sqrt(d1), sqrt(d2) - sqrt(d1), id);
}

float pathDist(vec2 p) {
  vec2 uv = (p - uBounds.xy) / (uBounds.zw - uBounds.xy);
  return texture(uPath, uv).r * uPathRange;
}

vec3 skyColour(float el) { return mix(uSkyHorizon, uSkyTop, pow(sat(el / 0.5), 0.55)); }

// Each set fades by its own footprint: lines running away from the lens survive a grazing view, the others give tone.
float lineScreen(vec2 p, float tone) {
  float ink = 0.0;
  vec3 limits = vec3(0.95, 0.6, 0.3);
  vec3 angles = vec3(0.52, -0.61, 1.45);
  for (int k = 0; k < 3; k++) {
    vec2 d = vec2(cos(angles[k]), sin(angles[k]));
    float u = dot(p, d) / PITCH;
    float fu = length(vec2(dFdx(u), dFdy(u)));
    float vis = sat(0.4 / max(fu, 1e-4) - 0.6);
    float l = abs(fract(u) - 0.5) * 2.0;
    float w = 0.3 + 0.3 * sat((limits[k] - tone) / limits[k]);
    ink = max(ink, smoothstep(w + fu, w - fu, l) * smoothstep(limits[k], limits[k] - 0.15, tone) * vis);
  }
  return ink;
}

void main() {
  vec2 p = vWorld.xz;
  float z = p.y;
  float grain = fbm3(p * 1.7);
  float patchN = fbm3(p * PATCH_SCALE + 3.0);
  vec3 base = mix(EARTH, mix(MOSS_FLOOR, ROAM_LAWN, uEye.z), smoothstep(0.38, 0.62, patchN));
  base *= 1.0 + PATCH_CONTRAST * (2.0 * fbm3(p * PATCH_SCALE * 1.9 + 11.0) - 1.0);
  if (uEye.z > 0.0) {
    float dry = smoothstep(0.4, 0.65, fbm3(p * LAWN_DRY_SCALE + 23.0));
    base = mix(base, base * LAWN_DRY, dry * uEye.z);
    float pd = pathDist(p);
    float edgeSoil = smoothstep(HALF_WIDTH, HALF_WIDTH + 0.1, pd) * (1.0 - smoothstep(SOIL_EDGE.x, SOIL_EDGE.x + SOIL_EDGE.y, pd + SOIL_EDGE.y * (valueNoise(p * 2.1) - 0.5)));
    float bedSoil = smoothstep(SOIL_BEDS.x, SOIL_BEDS.y, z + 0.5 * (valueNoise(p * 1.3 + 9.0) - 0.5));
    vec3 soil = SOIL * (0.7 + 0.6 * valueNoise(p * 13.0)) * (0.85 + 0.3 * grain);
    base = mix(base, soil, max(edgeSoil, bedSoil) * SOIL_SHARE * uEye.z);
  }
  vec4 clod = voronoi(p * 9.0);
  float pebble = smoothstep(0.22, 0.1, clod.x + 0.08 * valueNoise(p * 40.0)) * step(0.88, hash12(clod.zw));
  base *= (0.72 + 0.56 * grain) * (0.85 + 0.3 * valueNoise(p * 23.0)) * (1.0 + 0.5 * pebble) * mix(1.0, mix(0.32, ROAM_NEAR_DIM, uEye.z), sat((z + 1.0) / 4.5));
  base *= mix(0.45, 1.0, smoothstep(uWallZ, uWallZ + WALL_FADE, z + 0.08 * valueNoise(p * 7.0)));
  vec3 n = vec3(0.0, 1.0, 0.0);

  // Moss at the wall foot.
  float moss = smoothstep(-4.6, -5.8, z) * smoothstep(0.45, 0.62, fbm3(p * 2.3 + 5.0));
  base = mix(base, mix(MOSS_SHADE, MOSS_MID, grain), moss * 0.85);

  // Flagstones: a stone exists where its centre lies on the path, so the path edge is the stones' own edge.
  vec2 warp = 0.22 * (vec2(valueNoise(p * 3.1), valueNoise(p * 3.1 + 17.0)) - 0.5);
  vec4 v = voronoi(p / CELL + warp);
  vec2 centre = (v.zw + 0.5) * CELL;
  float onPath = step(pathDist(centre), HALF_WIDTH) * step(pathDist(p), HALF_WIDTH + CELL * 0.6);
  float border = v.y * CELL;
  float stoneMask = onPath * smoothstep(0.005, 0.014, border);
  if (onPath > 0.0) {
    float rot = (hash12(v.zw) - 0.5) * 0.28;
    vec2 sp = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)) * p * 0.45 + hash22(v.zw) * 7.0;
    float photo = uStoneOn > 0.5 ? luma(texture(uStone, sp).rgb) : 0.25 + 0.2 * fbm3(sp * 9.0);
    float tone = 1.0 + (photo - 0.22) * 3.5;
    tone = max(floor(tone * 5.0 + 0.5) / 5.0 * 0.35 + tone * 0.65, 0.25);
    float worn = 1.0 + 0.12 * step(pathDist(centre), 0.35);
    vec3 stone = STONE * tone * worn * (0.7 + 0.6 * hash12(v.zw + 3.0)) * (0.85 + 0.3 * fbm3(p * 6.0));
    vec2 bevel = normalize(vec2(dFdx(border), dFdy(border)) + 1e-5) * (1.0 - smoothstep(0.03, 0.07, border)) * 0.35;
    vec3 nm = uStoneOn > 0.5 ? texture(uStoneN, sp).xyz * 2.0 - 1.0 : vec3(0.0, 0.0, 1.0);
    vec3 sn = normalize(vec3(nm.x * 0.6 + bevel.x, 1.0, nm.y * 0.6 + bevel.y));
    float joint = 1.0 - stoneMask;
    vec3 jointCol = mix(base * 0.45, GRASS * 0.5, smoothstep(0.45, 0.75, grain));
    base = mix(base, mix(stone, jointCol, joint), onPath);
    n = normalize(mix(n, sn, stoneMask));
  }

  // Puddles: dark wet ground that mirrors the sky; the hand rings the water under the cursor.
  float wet = 0.0;
  vec2 q0 = vec2(0.0);
  for (int i = 0; i < 12; i++) {
    if (i >= uPuddles) break;
    vec4 q = uPuddle[i];
    vec2 e = (p - q.xy) / q.zw;
    float r = length(e) * (1.0 + 0.18 * (valueNoise(e * 3.0 + float(i) * 5.0) - 0.5));
    float w = smoothstep(1.0, 0.85, r);
    if (w > wet) { wet = w; q0 = q.xy; }
  }

  // The ramp colours are the ground as seen under the place's ambient; the key adds relief, the hand its warm pool.
  float key = luma(uMoonColor) * wrapLight(dot(n, uMoonDir), 0.3);
  vec3 hand = handLights(vWorld, n);
  // The hand's throw on the ground: off the light's foot, stretched along the line from the lens through the light and
  // brightest on the side nearer it, with a gaussian edge so it reads as thrown light, not a round decal.
  vec2 axis = normalize(uCursor.xz - uCamPos.xz + vec2(0.0, -1e-3));
  vec2 dp = p - uCursor.xz - axis * (POOL_SHAPE.x * uCursor.w);
  float along = dot(dp, axis) / (POOL_SHAPE.y * uCursor.w);
  float across = (dp.x * axis.y - dp.y * axis.x) / (POOL_SHAPE.z * uCursor.w);
  float pool = exp(-2.2 * (along * along + across * across)) * (1.0 - 0.45 * smoothstep(-0.6, 0.9, along));
  hand += uCursorColor * (pool * POOL * uHandOn);
  vec3 albedo = base * GROUND_ALBEDO;
  // Moss and earth under the hand go nearly grey first: the amber light, not the moss, sets the pool's hue.
  vec3 grey = mix(albedo, vec3(luma(albedo)), POOL_GREY);
  vec3 col = base * (0.5 + 1.6 * key) + keyLit(grey, hand * uHandThrow);
  // The lanterns' pools on the ground's own value (fully grey: amber on moss must not turn olive), broken by its grain
  // and rolled off toward LAMP_CEIL so lit stone keeps its edges.
  vec3 lamp = vec3(max(luma(albedo), LAMP_LAWN)) * lampLightsGain(vWorld, n, CARRIED_POOL) * (1.0 - LAMP_GRAIN + LAMP_GRAIN * 2.0 * fbm3(p * 1.7));
  // The moss's own green fades where a lantern reaches, so amber over green never sums to olive.
  col = mix(col, vec3(luma(col)), LAMP_GREEN_FADE * sat(luma(lamp) / LAMP_CEIL * 4.0));
  col += lamp / (1.0 + luma(lamp) / LAMP_CEIL);
  // Under roam the near fill loses most of its cool cast, so the lawn reads as grass at dusk, not teal felt.
  vec3 fill = mix(neutralise(uAmbient), vec3(luma(uAmbient)), ROAM_FILL_GREY * uEye.z) * GROUND_FILL * fillAt(vDepth);
  col += mix(fill, albedo * luma(fill) * ROAM_FILL_LIT, uEye.z);

  if (wet > 0.0) {
    vec2 toC = p - uCursor.xz;
    float rr = length(toC);
    float ring = cos(rr * 26.0 - uTime * 4.0) * exp(-rr * 3.0) * smoothstep(1.0, 0.15, rr);
    vec3 wn = normalize(vec3(normalize(toC + 1e-4) * ring * 0.05 + (vec2(valueNoise(p * 9.0 + uTime * 0.3), valueNoise(p * 9.0 - uTime * 0.3)) - 0.5) * 0.04, 1.0).xzy);
    vec3 view = normalize(vWorld - uCamPos);
    vec3 refl = reflect(view, wn);
    vec3 mirror = col * 0.55 + skyColour(refl.y) * 0.1;
    // The moon streak: a moon-wide band at the moon's azimuth, broken by the ripples (elevation ignored on purpose).
    float dAz = atan(refl.x, -refl.z) - atan(uMoonBack.x, -uMoonBack.z);
    float near = step(abs(atan(view.x, -view.z) - atan(uMoonBack.x, -uMoonBack.z)), GLINT_AZ);
    float dashes = smoothstep(0.45, 0.6, valueNoise(vec2(q0.x * 3.0, (p.y + ring * 0.05) * 9.0)));
    float glint = near * exp(-sq(dAz / 0.012)) * dashes;
    mirror += uMoonBody / max(luma(uMoonBody), 1e-3) * glint * GLINT;
    vec3 toLight = normalize(uCursor.xyz - vWorld);
    mirror += uCursorColor * pow(max(dot(refl, toLight), 0.0), 24.0) * handReach(vWorld) * 0.35;
    col = mix(col, min(mirror, vec3(WET_CEILING)), wet);
  }

  float tone = sat(luma(col) / 0.22);
  col *= 1.0 - LINE_CONTRAST * lineScreen(p, tone) * (1.0 - wet);
  vec3 haze = neutralise(uHaze.rgb);
  col = mix(col, haze, 1.0 - exp(-max(vDepth - mix(HAZE_START, ROAM_HAZE_START, uEye.z), 0.0) * uHaze.w));
  float dist = length(vWorld - uCamPos);
  float back = uFocusBack.w * smoothstep(0.35, 1.6, dist - length(uFocusBack.xyz - uCamPos));
  col = layerAir(col, dist - length(uCursor.xyz - uCamPos), back);
  // Past the wall: mist, not a slab. The far fields rise into the horizon sky, so a low wall never opens onto black.
  float past = smoothstep(uWallZ - 0.5, uWallZ - 6.0, z);
  float far = smoothstep(uWallZ - 6.0, uWallZ - FIELDS_DEPTH, z);
  col = mix(col, haze, past * 0.8);
  vec3 fields = mix(vec3(luma(uSkyHorizon)), uSkyHorizon, FIELDS_CHROMA) * mix(FIELDS_NEAR, FIELDS_FAR, far);
  col = mix(col, fields, past * (0.5 + 0.5 * far));
  if (uEnclose.z > uEnclose.x) {
    // Free roam: past the closed garden's walls the ground is the shadowed foot of the hedge, never a lit plain.
    vec2 inside = step(uEnclose.xy, p) * step(p, uEnclose.zw);
    col = mix(HEDGE_FOOT, col, inside.x * inside.y);
  }
  outColor = vec4(col, 1.0);
}
