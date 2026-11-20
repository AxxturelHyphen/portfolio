// The warm pool a signpost's lantern throws on its plank, fragment stage (common.glsl prepended): added over the lit
// plank (additive blend), the plank's own paint times the lantern colour, strongest round the flame and along the top
// of the board, with a very slow flicker. Linear colour.
uniform sampler2D uColor;
uniform vec3 uLampColor;
uniform float uTime;
uniform float uFlicker;     // 0 under reduced motion

in vec2 vUV;
in vec2 vQ;
in vec2 vSize;
in vec2 vFlame;
in float vGlow;
in float vPhase;

out vec4 outColor;

const float POOL_M = 0.75;        // the pool's reach on the board (m)
const float GLOW = 0.1;           // the pool's strength on the paint
const float WASH = 0.02;          // a faint warm wash over the board's top, whatever the paint
const vec2 TOP = vec2(0.35, 0.8); // share of the plank sprite's height where the wash starts and is full

void main() {
  vec4 tex = texture(uColor, vUV);
  vec2 d = (vQ - vFlame) * vSize;
  float pool = exp(-dot(d, d) / (POOL_M * POOL_M));
  float flicker = 1.0 + uFlicker * (0.07 * sin(uTime * 1.1 + vPhase) + 0.04 * sin(uTime * 0.37 + vPhase * 2.3));
  vec3 light = uLampColor * vGlow * flicker * (GLOW * pool * (tex.rgb + 0.08) + WASH * smoothstep(TOP.x, TOP.y, vQ.y) * (0.4 + pool));
  outColor = vec4(light * tex.a, 0.0);
}
