// The one cutout material, fragment stage. Lighting in linear space (the colour atlas is sampled as sRGB),
// output premultiplied. Light model: cook/ARCH.md section 2.7.
precision highp float;

uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform float uReveal;
uniform vec4 uCursor;      // xyz, radius
uniform vec3 uCursorColor;
uniform vec4 uGather;      // xyz, amount
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uShadow;      // uv offset per unit lift, softness (mip bias), strength
uniform vec4 uDepthFade;   // rgb, amount per unit of -z

in vec2 vUV;
in vec4 vRect;
in vec3 vWorld;
in vec4 vTint;
in vec3 vFrame;
in float vLift;

out vec4 outColor;

float sat(float x) { return clamp(x, 0.0, 1.0); }
float sq(float x) { return x * x; }
float wrapLight(float d, float w) { return max((d + w) / (1.0 + w), 0.0); }

// Alpha of the sprite at uv, zero outside its own rect so a tap never reads a neighbour in the atlas.
float rectAlpha(vec2 uv, float bias) {
  vec2 inside = step(vRect.xy, uv) * step(uv, vRect.zw);
  return texture(uColor, uv, bias).a * inside.x * inside.y;
}

void main() {
  vec4 tex = texture(uColor, vUV);
  vec2 nxy = texture(uNormal, vUV).xy * 2.0 - 1.0;
  nxy.x *= vFrame.z;
  nxy = vec2(vFrame.x * nxy.x - vFrame.y * nxy.y, vFrame.y * nxy.x + vFrame.x * nxy.y);
  vec3 n = normalize(vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.05))));

  vec3 toCursor = uCursor.xyz - vWorld;
  float r2 = max(uCursor.w * uCursor.w, 1e-4);
  float cursorFall = sq(sat(1.0 - dot(toCursor, toCursor) / r2));
  vec3 toGather = uGather.xyz - vWorld;
  float gather = uGather.w * sq(sat(1.0 - dot(toGather, toGather) / r2));
  vec3 l = normalize(toCursor + vec3(0.0, 0.0, 1e-3));

  vec3 albedo = tex.rgb * vTint.rgb;
  vec3 ambient = mix(uSkyHorizon, uSkyTop, n.y * 0.5 + 0.5);
  vec3 cursorLight = uCursorColor * wrapLight(dot(n, l), 0.25) * cursorFall * (1.0 + gather);
  vec3 lit = albedo * (ambient + uMoonColor * wrapLight(dot(n, uMoonDir), 0.4) + cursorLight);

  // Lifted paper edge: the rim catches the light on the lit side and shades on the far side.
  float edge = sat(tex.a * (1.0 - tex.a) * 4.0);
  vec2 lightXY = normalize(l.xy + vec2(1e-4, 0.0));
  float facing = dot(normalize(nxy + vec2(1e-4, 0.0)), lightXY);
  lit += albedo * edge * 0.35 * (uCursorColor * cursorFall + uMoonColor * 0.3) * max(facing, 0.0);
  lit *= 1.0 - edge * 0.25 * max(-facing, 0.0);

  lit = mix(lit, uDepthFade.rgb, sat(-vWorld.z * uDepthFade.w));

  // Contact shadow: a soft second alpha tap toward the light, so the shadow falls away from it, inside the gutter.
  vec2 shadowUV = vUV + lightXY * uShadow.x * vLift;
  float shadow = rectAlpha(shadowUV, uShadow.y) * uShadow.z * sat(vLift * 4.0);

  float opacity = vTint.a * uReveal;
  float a = tex.a * opacity;
  float shadowA = shadow * opacity * (1.0 - a);
  outColor = vec4(lit * a, a + shadowA);
}
