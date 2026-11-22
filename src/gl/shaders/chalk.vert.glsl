// Chalk marks (src/gl/chalk.ts): flat decals laid on the ground or a wall's face, merged into one mesh; each vertex
// names its mark, whose drawing progress and opacity come from uMarks.
uniform mat4 uViewProj;
uniform vec4 uMarks[MARKS];   // x: how far the mark has chalked itself on (0..1), y: opacity

in vec3 position;
in vec3 normal;
in vec2 uv;
in float aMark;
in vec3 aTint;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vDepth;   // the fragment's view depth
flat out vec2 vMark;
flat out vec3 vTint;

void main() {
  vec4 m = uMarks[int(aMark + 0.5)];
  vMark = m.xy;
  vTint = aTint;
  vWorld = position;
  vNormal = normal;
  vUv = uv;
  gl_Position = uViewProj * vec4(position, 1.0);
  // A hidden mark costs no fragments.
  if (m.y <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vDepth = gl_Position.w;
}
