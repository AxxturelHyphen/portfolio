// The one cutout material, fragment stage (common.glsl and lights.glsl are prepended). Lighting in linear space (the
// colour atlas is sampled as sRGB), output premultiplied. Light model: cook/ARCH.md 2.7 with the roles of lights.ts.
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform float uReveal;
uniform vec3 uShadow;      // drop shadow onto what is behind: uv offset per unit lift, softness (mip bias), strength
uniform vec4 uDepthFade;   // haze rgb, density per metre past HAZE_START
uniform vec4 uShadowDir;   // decal x, z, length per height, opacity

in vec2 vUV;
in vec4 vRect;
in vec3 vWorld;
in vec4 vTint;
in float vSilhouette;
in vec4 vFrame;
in vec4 vOrient;
in float vLift;
in float vDecal;
in float vDepth;
in float vMirror;

out vec4 outColor;

const vec3 PAPER_BACK = vec3(0.184, 0.133, 0.067);   // acg-paper006 at #7b6648, linear
const float HAZE_START = 3.0;
const float DECAL_SOFT_BIAS = 3.5;                    // alpha from about mip 3: 30 to 70 px soft
const float DECAL_COVERAGE = 3.0;                     // sparse plants still cast a readable patch
const float CONTACT = 0.32;                           // the darker line where the paper meets the ground
const float EDGE_LIGHT = 0.55;
const float EDGE_DARK = 0.38;
const vec3 PAPER_RIM = vec3(0.815, 0.716, 0.597);    // #e9dccb pale paper edge, linear
const float PAPER_RIM_STRENGTH = 0.4;
const float TINT_FLOOR = 0.65;                        // shaded layers darken by 35 % at most
const float SHADED_FROM = 0.75;                       // tints darker than this luma count as a shaded layer
const float SILHOUETTE_HAZE = 0.3;                    // how far a shaded layer turns toward the haze hue
const vec3 COOL_RIM = vec3(0.30, 0.36, 0.46);         // moonlit rim on the shaded layers
const float AMBIENT_GAIN = 1.6;                       // the moonlit dusk fill: midground paper reads, blacks stay
// Lit paper keeps its hue: the brightest channel rolls off from KNEE toward CEIL (linear), the others follow it, so a
// lit crimson stays crimson instead of washing to coral and no paper passes about luma 215 after the grade.
const float KNEE = 0.22;
const float CEIL = 0.36;

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

// Direction in the sprite's uv frame of a world-space xy direction (undoes rotation and flip).
vec2 toSpriteUV(vec2 d) {
  vec2 local = vec2(vFrame.x * d.x + vFrame.y * d.y, -vFrame.y * d.x + vFrame.x * d.y);
  local.x *= vFrame.z;
  return normalize(local + vec2(1e-4, 0.0));
}

vec4 decal() {
  vec2 size = vRect.zw - vRect.xy;
  float spread = size.x * (0.04 + 0.1 * vDecal);
  float a = 0.25 * (rectAlpha(vUV + vec2(-spread, 0.0), DECAL_SOFT_BIAS) + rectAlpha(vUV + vec2(spread, 0.0), DECAL_SOFT_BIAS)
    + rectAlpha(vUV + vec2(0.0, -spread), DECAL_SOFT_BIAS) + rectAlpha(vUV + vec2(0.0, spread), DECAL_SOFT_BIAS));
  float foot = rectAlpha(vec2(vUV.x, vRect.y + size.y * 0.02), 1.0);
  float contact = CONTACT * foot * (1.0 - smoothstep(0.0, 0.06, vDecal));
  float op = (uShadowDir.w * sat(a * DECAL_COVERAGE) * pow(1.0 - vDecal, 1.4) + contact) * vTint.a * uReveal;
  return vec4(neutralise(uShadowColor) * 0.5 * op, op);
}

void main() {
  if (vFrame.w < 0.5) {
    outColor = decal();
    return;
  }
  vec4 tex = texture(uColor, vUV);
  vec2 nxy = texture(uNormal, vUV).xy * 2.0 - 1.0;
  nxy.x *= vFrame.z * (vMirror > 0.5 ? -1.0 : 1.0);
  nxy = vec2(vFrame.x * nxy.x - vFrame.y * nxy.y, vFrame.y * nxy.x + vFrame.x * nxy.y);
  vec3 n = vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.05)));
  // Shaded layers keep their plate: the place tint is capped and turned toward the haze hue, not a brown multiply.
  float shaded = sat((SHADED_FROM - luma(vTint.rgb)) / (SHADED_FROM - TINT_FLOOR)) * (1.0 - vSilhouette);
  vec3 albedo = tex.rgb * max(vTint.rgb, vec3(TINT_FLOOR * (1.0 - vSilhouette)));
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

  vec3 ambient = neutralise(uAmbient) * AMBIENT_GAIN * mix(0.8, 1.25, n.y * 0.5 + 0.5);
  vec3 key = neutralise(uMoonColor) * wrapLight(dot(n, uMoonDir), 0.4);
  vec3 rim = uRimColor * sq(max(dot(n, uMoonBack), 0.0)) * 2.0;
  vec3 hand = handLights(vWorld, n);
  vec3 lit = paperShoulder(albedo * (ambient + key + rim + hand));

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

  lit = mix(lit, haze, 1.0 - exp(-max(vDepth - HAZE_START, 0.0) * uDepthFade.w));

  // Drop shadow onto the paper behind: the sprite's alpha pushed away from the light, inside its gutter.
  float shadow = rectAlpha(vUV - lightUV * uShadow.x * vLift, uShadow.y) * uShadow.z * sat(vLift * 4.0) * (0.6 + 0.4 * reach);

  float opacity = vTint.a * uReveal;
  float a = tex.a * opacity;
  float shadowA = shadow * opacity * (1.0 - a);
  outColor = vec4(lit * a + neutralise(uShadowColor) * 0.4 * shadowA, a + shadowA);
}
