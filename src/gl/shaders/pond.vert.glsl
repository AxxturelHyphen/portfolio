// Pond: one quad just above the ground over the water's rectangle (src/gl/pond.ts).
uniform mat4 uViewProj;
uniform vec4 uRect;   // x0, z0, x1, z1

in vec2 position;     // 0..1 over the rectangle
out vec3 vWorld;
out vec2 vLocal;      // -1..1 over the rectangle: the water is the unit circle

const float LIFT = 0.003;

void main() {
  vLocal = position * 2.0 - 1.0;
  vWorld = vec3(mix(uRect.x, uRect.z, position.x), LIFT, mix(uRect.y, uRect.w, position.y));
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
