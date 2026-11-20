// Ground height (after common.glsl, before both ground bodies): the same surface as src/core/terrain.ts, whose TERRAIN
// constants arrive as uniforms. The vertices take the soft relief (bank, soil); the fragment adds the hard detail
// (slabs, edging) by parallax.
uniform vec4 uBounds;          // x0, z0, x1, z1
uniform sampler2D uPath;       // distance to the path centre, 0..1 = 0..uPathRange metres
uniform float uPathRange;
uniform float uRelief;         // 1 under free roam, 0 on the rail
uniform vec4 uBank;            // z where the front starts, z where it is full, height, ramp behind the edging
uniform vec4 uEdging;          // face distance from the path centre, width, rise above the bank, slab height
uniform vec4 uPond;            // x, z, rx, rz (rx 0: no pond)
uniform vec2 uPondClear;
const float SOIL_RELIEF = 0.05;                       // the soil's own swell off the path, peak to peak (m)

float pathDist(vec2 p) {
  return textureLod(uPath, (p - uBounds.xy) / (uBounds.zw - uBounds.xy), 0.0).r * uPathRange;
}

// Where the bank stands at all: north of its front, off the pond rim.
float bankKeep(vec2 p) {
  float keep = 1.0 - smoothstep(uBank.y, uBank.x, p.y);
  if (uPond.z > 0.0) keep *= smoothstep(uPondClear.x, uPondClear.y, length((p - uPond.xy) / uPond.zw));
  return keep;
}

float baseHeight(vec2 p, float pd) {
  float back = uEdging.x + uEdging.y - 0.02;
  float keep = bankKeep(p);
  float bank = uBank.z * keep * smoothstep(back, back + uBank.w, pd);
  return uRelief * (bank + SOIL_RELIEF * (valueNoise(p * 1.3) - 0.5) * smoothstep(0.8, 1.1, pd) * mix(1.0, 0.4, keep));
}
