// Halation source at quarter resolution: a 4x4 box of the scene through a soft luma threshold.
// Reads the used uScale fraction of the scene target and writes the same fraction of the quarter target.
precision highp float;

uniform sampler2D uScene;
uniform float uScale;
uniform float uThreshold;

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
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(c * smoothstep(uThreshold, uThreshold * 1.5, luma), 1.0);
}
