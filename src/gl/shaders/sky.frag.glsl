// Procedural dusk sky with a large soft moon (P1 version). Linear output; the film pass grades and encodes.
precision highp float;

uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uMoonColor;
uniform vec4 uMoon;      // centre x, y (0..1 of the viewport), radius and halo radius in viewport heights
uniform float uAspect;   // viewport width / height
uniform float uHorizon;  // screen height of the horizon, 0..1

in vec2 vScreen;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float h = clamp((vScreen.y - uHorizon) / (1.0 - uHorizon), 0.0, 1.0);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(h, 0.6));
  // A thin warm band right at the horizon: the last of the dusk.
  sky += vec3(0.035, 0.015, 0.02) * exp(-h * 9.0);

  vec2 d = vec2((vScreen.x - uMoon.x) * uAspect, vScreen.y - uMoon.y);
  float r = length(d);
  float disc = 1.0 - smoothstep(uMoon.z * 0.9, uMoon.z * 1.03, r);
  vec2 q = d / max(uMoon.z, 1e-3);
  float mottle = 0.72 + 0.18 * noise(q * 2.2 + 3.0) + 0.1 * noise(q * 6.0 + 9.0);
  float halo = exp(-max(r - uMoon.z, 0.0) / max(uMoon.w, 1e-3) * 3.0);

  vec3 color = sky + uMoonColor * (halo * 0.35 + disc * 1.6 * mottle);
  outColor = vec4(color, 1.0);
}
