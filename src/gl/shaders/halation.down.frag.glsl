// Halation source at quarter resolution: a 4x4 box of the scene through a soft threshold on luma.
// Reads the used uScale fraction of the scene target and writes the same fraction of the quarter target.
// Alpha carries how cool (blue over red) the box is before the threshold: blurred with the glow, it is a soft map of the
// sky that the film pass keeps the red ring off, so the moon's ring never stains the warm coping under it in sharp shapes.
precision highp float;

uniform sampler2D uScene;
uniform float uScale;
uniform float uThreshold;

const float COOL_SLOPE = 4.0;         // film.frag.glsl HAL_COOL_SLOPE

in vec2 vUv;
out vec4 fragColor;

vec3 tap(vec2 uv) {
  vec2 half_ = 0.5 / vec2(textureSize(uScene, 0));
  return texture(uScene, clamp(uv, half_, uScale - half_)).rgb;
}

void main() {
  vec2 texel = 1.0 / vec2(textureSize(uScene, 0));
  vec2 uv = vUv * uScale;
  vec3 c = 0.25 * (tap(uv + vec2(-texel.x, -texel.y)) + tap(uv + vec2(texel.x, -texel.y))
    + tap(uv + vec2(-texel.x, texel.y)) + tap(uv + vec2(texel.x, texel.y)));
  // Only the brightest edges halate (moon, lit paper rims); a saturated red body no longer glows on its own.
  float level = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float cool = clamp((c.b - c.r) / max(c.b, 1e-3) * COOL_SLOPE, 0.0, 1.0);
  fragColor = vec4(c * smoothstep(uThreshold, uThreshold * 1.5, level), cool);
}
