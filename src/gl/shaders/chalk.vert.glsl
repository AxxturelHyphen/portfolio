// Chalk marks (src/gl/chalk.ts): flat decals laid on the ground, bent over the rock or standing in the air, merged into
// one mesh; each vertex names its mark, whose drawing progress, opacity, smear and float clock come from uMarks. A mark
// with its clock running (the cat's note in the air) bobs slowly; one being rubbed out slides aside as it smears.
uniform mat4 uViewProj;
uniform vec4 uMarks[MARKS];   // x: chalked on (0..1), y: opacity, z: rubbed out (0..1), w: float clock (s)

in vec3 position;
in vec3 normal;
in vec2 uv;
in float aMark;
in vec3 aTint;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vDepth;   // the fragment's view depth
flat out vec4 vMark;
flat out vec3 vTint;

// The bob (m, Hz) and the slide of the smear (m).
const vec2 BOB = vec2(0.035, 0.22);
const float SMEAR_M = 0.12;

void main() {
  vec4 m = uMarks[int(aMark + 0.5)];
  vMark = m;
  vTint = aTint;
  vec3 p = position;
  p.y += sin(m.w * BOB.y * 6.2831853) * BOB.x;
  p.x += m.z * SMEAR_M;
  vWorld = p;
  vNormal = normal;
  vUv = uv;
  gl_Position = uViewProj * vec4(p, 1.0);
  // A hidden mark costs no fragments.
  if (m.y <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vDepth = gl_Position.w;
}
