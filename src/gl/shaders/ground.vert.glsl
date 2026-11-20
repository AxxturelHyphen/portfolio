// Ground: a grid over the layout rectangle, raised by the soft relief of ground.height.glsl (src/gl/ground.ts).
uniform mat4 uViewProj;

in vec2 position;       // 0..1 over the rectangle
out vec3 vWorld;
out float vDepth;

void main() {
  vec2 p = mix(uBounds.xy, uBounds.zw, position);
  vWorld = vec3(p.x, baseHeight(p, pathDist(p)), p.y);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
  vDepth = gl_Position.w;
}
