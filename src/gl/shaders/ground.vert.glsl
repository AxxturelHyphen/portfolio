// Ground plane: one quad at y = 0 over the layout rectangle (src/gl/ground.ts).
uniform mat4 uViewProj;
uniform vec4 uBounds;   // x0, z0, x1, z1

in vec2 position;       // 0..1 over the rectangle
out vec3 vWorld;
out float vDepth;

void main() {
  vWorld = vec3(mix(uBounds.x, uBounds.z, position.x), 0.0, mix(uBounds.y, uBounds.w, position.y));
  gl_Position = uViewProj * vec4(vWorld, 1.0);
  vDepth = gl_Position.w;
}
