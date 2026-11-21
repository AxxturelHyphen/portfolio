// Solid built things (src/gl/solid.material.ts): world positions and face normals, as merged at load.
uniform mat4 uViewProj;
uniform vec4 uCursor;
uniform vec4 uFocusBack;

in vec3 position;
in vec3 normal;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vDepth;   // the fragment's view depth, the hand's plane's and the fall-back plane's

void main() {
  vWorld = position;
  vNormal = normal;
  gl_Position = uViewProj * vec4(position, 1.0);
  vDepth = vec3(gl_Position.w, (uViewProj * vec4(uCursor.xyz, 1.0)).w, (uViewProj * vec4(uFocusBack.xyz, 1.0)).w);
}
