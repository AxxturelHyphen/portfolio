// Solid built things (src/gl/solid.material.ts): world positions and face normals, as merged at load, or under INSTANCED
// pieces placed one by one (a sign's board on its hook), and each vertex's paint (constant over a piece).
uniform mat4 uViewProj;
uniform vec4 uCursor;
uniform vec4 uFocusBack;

in vec3 position;
in vec3 normal;
in vec3 aTint;
in vec4 aLook;     // tile slot, tile scale, top-face lift, rock (1: the grotto's marks)
in vec3 aGlow;
#ifdef INSTANCED
in mat4 instanceMatrix;
#endif
out vec3 vWorld;
out vec3 vNormal;
out vec3 vDepth;   // the fragment's view depth, the hand's plane's and the fall-back plane's
flat out vec3 vTint;
flat out vec4 vLook;
flat out vec3 vGlow;

void main() {
#ifdef INSTANCED
  vWorld = (instanceMatrix * vec4(position, 1.0)).xyz;
  vNormal = mat3(instanceMatrix) * normal;
#else
  vWorld = position;
  vNormal = normal;
#endif
  vTint = aTint;
  vLook = aLook;
  vGlow = aGlow;
  gl_Position = uViewProj * vec4(vWorld, 1.0);
  vDepth = vec3(gl_Position.w, (uViewProj * vec4(uCursor.xyz, 1.0)).w, (uViewProj * vec4(uFocusBack.xyz, 1.0)).w);
}
