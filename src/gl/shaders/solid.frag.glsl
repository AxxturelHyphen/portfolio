// Solid built things (src/gl/solid.material.ts), after common.glsl and lights.glsl: the stone tile laid on every face at
// its real scale in world space, so blocks that meet run on over the same stones, tinted and lit as the stone cutouts
// are (cutout.frag.glsl): the dusk ambient, the moon key and rim, the lanterns with the carried one's shadow, the night
// away from the visitor, the haze, the layer air and the paper floor. Opaque.
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform vec4 uTile;        // metres per tile, normal map gain, then the tile's uv inset (its outer texels fade)
uniform vec4 uRect;        // the tile's uv rect on its atlas page
uniform vec3 uTint;
uniform vec3 uCamPos;
uniform vec4 uHaze;        // haze rgb, density per metre past ROAM_HAZE_START

in vec3 vWorld;
in vec3 vNormal;
in vec3 vDepth;
out vec4 outColor;

const float ROAM_HAZE_START = 7.0;
const float AMBIENT_GAIN = 1.6;
const float FILL = 0.6;
const float TINT_FLOOR = 0.5;
const float KNEE = 0.22;
const float CEIL = 0.36;
const vec2 FOOT_SHADE = vec2(0.14, 0.4);
const vec2 FOCUS_BACK = vec2(0.35, 1.6);
const float ROAM_FLOOR = 0.014;
const float ROAM_FLOOR_KNEE = 0.035;
// Edges seen edge-on darken toward the pencil, so a block's outline reads drawn, as the iron's bars do.
const vec3 GRAPHITE = vec3(0.011, 0.010, 0.012);
const vec2 GRAZE = vec2(0.05, 0.3);
const float GRAZE_INK = 0.35;

vec3 paperShoulder(vec3 c) {
  float m = max(max(c.r, c.g), max(c.b, 1e-4));
  float rolled = m < KNEE ? m : KNEE + (CEIL - KNEE) * (1.0 - exp(-(m - KNEE) / (CEIL - KNEE)));
  return c * (rolled / m);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 a = abs(n);
  // The face's own plane: tops take x, z; sides take their run and height. t, b: the tile's u and v in world space.
  vec3 t = a.y > max(a.x, a.z) ? vec3(1.0, 0.0, 0.0) : normalize(vec3(n.z, 0.0, -n.x));
  vec3 b = a.y > max(a.x, a.z) ? vec3(0.0, 0.0, 1.0) : vec3(0.0, -1.0, 0.0);
  vec2 p = vec2(dot(vWorld, t), dot(vWorld, b)) / uTile.x;
  vec2 span = (uRect.zw - uRect.xy) * (1.0 - 2.0 * uTile.z);
  vec2 uv = uRect.xy + (uRect.zw - uRect.xy) * uTile.z + fract(p) * span;
  vec2 dx = dFdx(p) * span;
  vec2 dy = dFdy(p) * span;
  vec3 albedo = textureGrad(uColor, uv, dx, dy).rgb * max(uTint, vec3(TINT_FLOOR));
  vec2 nxy = textureGrad(uNormal, uv, dx, dy).xy * 2.0 - 1.0;
  n = normalize(n + (t * nxy.x - b * nxy.y) * uTile.y);

  vec3 night = nightOf(vWorld);
  vec3 ambient = neutralise(uAmbient) * AMBIENT_GAIN * mix(0.8, 1.25, n.y * 0.5 + 0.5) * (1.0 + FILL * fillAt(vDepth.x));
  vec3 key = neutralise(uMoonColor) * wrapLight(dot(n, uMoonDir), 0.4);
  vec3 rim = uRimColor * sq(max(dot(n, uMoonBack), 0.0)) * 2.0;
  vec3 hand = handLights(vWorld, n) + lampLights(vWorld, n) + inviteLights(vWorld, n);
  vec3 lit = paperShoulder(albedo * (ambient + key + rim) * night + keyLit(albedo, hand));
  lit *= 1.0 - FOOT_SHADE.y * uEye.z * (1.0 - smoothstep(0.0, FOOT_SHADE.x, vWorld.y));

  vec3 v = normalize(uCamPos - vWorld);
  float hazed = 1.0 - exp(-max(vDepth.x - ROAM_HAZE_START, 0.0) * uHaze.w);
  vec3 haze = neutralise(uHaze.rgb);
  float back = uFocusBack.w * smoothstep(FOCUS_BACK.x, FOCUS_BACK.y, vDepth.x - vDepth.z);
  lit = layerAir(mix(lit, haze, hazed), vDepth.x - vDepth.y, back);
  vec3 hazeHue = mix(vec3(1.0), haze / max(luma(haze), 1e-3), 0.5);
  lit += hazeHue * ROAM_FLOOR * uEye.z * (1.0 - smoothstep(0.0, ROAM_FLOOR_KNEE, luma(lit)));
  lit = mix(lit, GRAPHITE, GRAZE_INK * (1.0 - smoothstep(GRAZE.x, GRAZE.y, abs(dot(normalize(vNormal), v)))) * (1.0 - hazed));
  outColor = vec4(lit, 1.0);
}
