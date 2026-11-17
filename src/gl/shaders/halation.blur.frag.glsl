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
// Weight of tap |i| (offset i * STEP texels): 0.12 of the normalised tight lobe exp(-o^2 / (2 * 3^2)) plus 0.88 of the
// normalised wide lobe exp(-o^2 / (2 * 11^2)), both summed over the 25 taps. The wide lobe carries the 45 px
// half-strength radius at 1080p. Folded into constants so the loop is reads and multiply-adds only.
const float WEIGHT[RADIUS + 1] = float[RADIUS + 1](
  0.097239071, 0.089808673, 0.074265252, 0.060613640, 0.051055331, 0.043335960, 0.036039319,
  0.029062767, 0.022680475, 0.017124527, 0.012509173, 0.008840600, 0.006044746
);

void main() {
  vec2 texel = 1.0 / vec2(textureSize(uSrc, 0));
  vec2 half_ = 0.5 * texel;
  vec2 uv = vUv * uScale;
  vec2 stride = uDir * texel * STEP;
  vec2 hi = uScale - half_;
  vec3 sum = vec3(0.0);
  for (int i = -RADIUS; i <= RADIUS; i++) {
    sum += texture(uSrc, clamp(uv + stride * float(i), half_, hi)).rgb * WEIGHT[abs(i)];
  }
  fragColor = vec4(sum, 1.0);
}
