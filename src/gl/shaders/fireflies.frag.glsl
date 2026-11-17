// A firefly is a hot warm core with a short glow (the halation pass adds the bleed); a mote is a faint warm speck that
// only exists inside the hand light. Additive, linear.
uniform vec3 uFlyColor;
uniform vec3 uCursorColor;

in vec2 vCorner;
in float vBright;
in float vKind;
out vec4 outColor;

void main() {
  float r = length(vCorner);
  if (r > 1.0) discard;
  float core = smoothstep(0.3, 0.0, r);
  float glow = exp(-r * 4.0) * (1.0 - r);
  vec3 fly = uFlyColor * (core * 4.0 + glow * 0.6);
  vec3 mote = uCursorColor * 0.35 * smoothstep(1.0, 0.2, r);
  outColor = vec4(mix(fly, mote, vKind) * vBright, 0.0);
}
