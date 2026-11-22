// The burlap doll and its lantern (src/gl/doll.ts): posed in the doll's frame on the CPU, placed by its model matrix.
uniform mat4 modelMatrix;
uniform mat4 uViewProj;
uniform vec4 uCursor;
uniform vec4 uFocusBack;

in vec3 position;
in vec3 normal;
in vec4 aPaint;   // rgb, kind
in vec2 aFab;     // the weave's coordinates (m), or the shadow's radius share
out vec3 vWorld;
out vec3 vNormal;
out vec3 vDepth;
out vec2 vFab;
flat out vec4 vPaint;

void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormal = mat3(modelMatrix) * normal;
  vFab = aFab;
  vPaint = aPaint;
  gl_Position = uViewProj * vec4(vWorld, 1.0);
  vDepth = vec3(gl_Position.w, (uViewProj * vec4(uCursor.xyz, 1.0)).w, (uViewProj * vec4(uFocusBack.xyz, 1.0)).w);
}
