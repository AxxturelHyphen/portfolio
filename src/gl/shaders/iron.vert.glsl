// The iron gate (src/gl/irongate.ts): each leaf turns 80 degrees away from the garden about its hinge pin, the right leaf
// a moment after the left, slow out of rest and slow into it, as the exit's push (uOpen) starts.
uniform mat4 uViewProj;
uniform vec4 uCursor;
uniform float uOpen;   // world/exit.ts push, 0..1
const float OPEN = 9.0;   // the push is an ease-in cubed: the gate stands open by about half the way to its landing
uniform vec3 uHinge;   // left pin x, right pin x, pin z

in vec3 position;
in float aLeaf;        // -1 left leaf, 1 right leaf
out vec3 vWorld;
out vec2 vDepth;

void main() {
  float a = -aLeaf * 1.4 * smoothstep(0.0, 0.85, uOpen * OPEN - 0.075 - 0.075 * aLeaf);
  vec2 pin = vec2(aLeaf < 0.0 ? uHinge.x : uHinge.y, uHinge.z);
  vec2 xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * (position.xz - pin) + pin;
  vWorld = vec3(xz.x, position.y, xz.y);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
  vDepth = vec2(gl_Position.w, (uViewProj * vec4(uCursor.xyz, 1.0)).w);
}
