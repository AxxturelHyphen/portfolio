// Hand-made marks, prepended to the film pass after kaleido.glsl: the chalk grade (sage and moss greens, dusty rose,
// warm grey paper, ink blacks; only the warm lantern light and the red accents keep their saturation), the tooth of
// rough paper that dry pastel skips over in the light areas, and sparse diagonal pencil hatching in the shadows. The
// marks hold still between 12 fps steps and boil through three drawings; reduced motion holds the first. Display values.
uniform float uBoil;    // the 12 fps step, 0 under reduced motion
uniform float uHatch;   // hatching strength, 0 on the low tier

const vec3 SAGE = vec3(0.612, 0.686, 0.533);    // #9caf88, the lit greens
const vec3 MOSS = vec3(0.420, 0.478, 0.294);    // #6b7a4b, the greens in shade
const vec3 ROSE = vec3(0.788, 0.561, 0.561);    // #c98f8f, pinks and magentas
const vec3 PAPER = vec3(0.851, 0.820, 0.761);   // #d9d1c2, pale neutrals
const float GREEN_PULL = 0.3;
const float ROSE_PULL = 0.25;
const float PAPER_PULL = 0.3;
const float CHALK_KEEP = 0.9;    // saturation kept outside the warm accents
const float INK_KEEP = 0.6;      // and in the deepest lows: ink is neutral
const float TOOTH_PX_1080 = 1.6;
const vec3 TOOTH_PIT = vec3(0.89, 0.875, 0.86);  // a bare pit in the lights: about 12 % under, a touch warm
const float HATCH_PX_1080 = 7.0;          // spacing between strokes
const float HATCH_DASH = 7.0;             // stroke length in spacings
const vec2 HATCH_DIR = vec2(0.80, 0.60);  // strokes rise to the right, as a right hand hatches
const float HATCH_FILL = 0.5;             // share of the stroke slots drawn
const float HATCH_WIDTH = 0.09;           // half width in spacings: about 1.3 px at 1080p
const float HATCH_DEPTH = 0.3;
const float HATCH_PATCH_PX_1080 = 140.0;  // hatching comes in patches, not as a screen

vec3 chalk(vec3 c) {
  float y = luma(c);
  float hi = max(max(c.r, c.g), c.b);
  float s = (hi - min(min(c.r, c.g), c.b)) / max(hi, 1e-4);
  float warm = smoothstep(0.35, 0.6, (c.r - c.b) / max(c.r, 1e-3)) * sat((c.r - c.g) * 6.0 + 0.3);
  float green = sat((c.g - c.r) * 6.0) * sat((c.g - c.b) * 4.0 + 0.8);
  vec3 leaf = mix(MOSS, SAGE, smoothstep(0.15, 0.5, y));
  c = mix(c, leaf * (y / luma(leaf)), green * GREEN_PULL);
  float rose = sat((c.r - c.g) * 5.0) * sat((c.b - c.g) * 5.0 + 0.5) * sat((c.r - c.b) * 5.0 + 0.5) * (1.0 - warm);
  c = mix(c, ROSE * (y / luma(ROSE)), rose * ROSE_PULL);
  float pale = smoothstep(0.5, 0.8, y) * (1.0 - smoothstep(0.1, 0.3, s));
  c = mix(c, PAPER * (y / luma(PAPER)), pale * PAPER_PULL);
  float keep = mix(CHALK_KEEP, 1.0, warm) * mix(INK_KEEP, 1.0, smoothstep(0.03, 0.15, y));
  return max(vec3(y) + (c - y) * keep, 0.0);
}

// Pastel on rough paper: the pits of the tooth stay bare where the light areas are laid on. Each step nudges the
// paper by part of a cell, so the tooth shimmers on the 12 fps beat instead of dancing every frame.
vec3 tooth(vec3 col, vec2 film, float k1080, float drawing) {
  vec2 p = film / (TOOTH_PX_1080 * k1080) * vec2(0.75, 1.0) + vec2(0.6, 0.3) * drawing;
  float n = 0.65 * valueNoise(p) + 0.35 * valueNoise(p * 2.3 + 5.2);
  float pit = smoothstep(0.45, 0.75, n);
  float y = luma(col);
  float light = mix(0.2, 1.0, smoothstep(0.3, 0.7, y)) * (1.0 - 0.6 * smoothstep(0.8, 0.95, y));
  return col * mix(vec3(1.0), TOOTH_PIT, pit * light);
}

// One pencil stroke per slot: which slots are drawn and how hard stays fixed, the line itself (its offset, bow and
// ends) is redrawn for each of the three drawings, so the hatching boils gently.
float hatch(vec2 film, float k1080, float drawing) {
  vec2 p = film / (HATCH_PX_1080 * k1080);
  vec2 d = vec2(dot(p, HATCH_DIR), dot(p, vec2(-HATCH_DIR.y, HATCH_DIR.x)));
  float line = floor(d.y);
  float along = d.x / HATCH_DASH + hash12(vec2(line, 3.0)) * 7.0;
  float slot = floor(along);
  float drawn = hash12(vec2(line * 1.37 + slot, 11.0));
  vec2 boil = hash22(vec2(line + slot * 3.1, drawing * 17.0 + 5.0)) - 0.5;
  float t = fract(along) + boil.x * 0.12;
  float centre = 0.5 + boil.y * 0.25 + 0.08 * sin(t * 3.14159 + drawn * 6.0);
  float aa = 0.5 / (HATCH_PX_1080 * k1080);
  float stroke = 1.0 - smoothstep(HATCH_WIDTH - aa, HATCH_WIDTH + aa, abs(fract(d.y) - centre));
  float ends = smoothstep(0.05, 0.18, t) * smoothstep(0.95, 0.7, t);
  return step(drawn, HATCH_FILL) * stroke * ends * (0.6 + 0.8 * drawn);
}

// The marks over the graded picture: hatching keyed to the shadows (never the ink floor), then the paper tooth.
vec3 marks(vec3 col, vec2 film, float k1080) {
  float drawing = mod(uBoil, 3.0);
  if (uHatch > 0.0) {
    float y = luma(col);
    float shade = smoothstep(0.04, 0.1, y) * (1.0 - smoothstep(0.2, 0.36, y));
    float clump = smoothstep(0.35, 0.6, valueNoise(film / (HATCH_PATCH_PX_1080 * k1080)));
    if (shade * clump > 0.0) col *= 1.0 - uHatch * HATCH_DEPTH * shade * clump * hatch(film, k1080, drawing);
  }
  return tooth(col, film, k1080, drawing);
}
