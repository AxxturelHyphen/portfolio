// One axis of the halation blur at quarter resolution: the sum of a tight and a wide gaussian (cook/SHOTS.md B:
// sigma 3 px plus sigma 11 px at quarter resolution). 25 taps, 2 texels apart, clamped to the used uScale fraction.
precision highp float;

uniform sampler2D uSrc;
uniform vec2 uDir;
uniform float uScale;

in vec2 vUv;
out vec4 fragColor;

const int RADIUS = 12;
const float STEP = 2.0;
const float INV_TIGHT = 1.0 / (2.0 * 3.0 * 3.0);
const float INV_WIDE = 1.0 / (2.0 * 11.0 * 11.0);

void main() {
  vec2 texel = 1.0 / vec2(textureSize(uSrc, 0));
  vec2 half_ = 0.5 * texel;
  vec2 uv = vUv * uScale;
  vec3 tight = vec3(0.0), wide = vec3(0.0);
  float tightSum = 0.0, wideSum = 0.0;
  for (int i = -RADIUS; i <= RADIUS; i++) {
    float o = float(i) * STEP;
    vec3 c = texture(uSrc, clamp(uv + uDir * texel * o, half_, uScale - half_)).rgb;
    float wt = exp(-o * o * INV_TIGHT);
    float ww = exp(-o * o * INV_WIDE);
    tight += c * wt;
    wide += c * ww;
    tightSum += wt;
    wideSum += ww;
  }
  fragColor = vec4(0.5 * (tight / tightSum + wide / wideSum), 1.0);
}
