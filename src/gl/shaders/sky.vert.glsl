// Fullscreen sky: one triangle at the far plane; the fragment stage gets the world view ray.
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;

in vec2 position;
out vec3 vRay;

void main() {
  vec4 far = uInvViewProj * vec4(position, 1.0, 1.0);
  vRay = far.xyz / far.w - uCamPos;
  gl_Position = vec4(position, 0.0, 1.0);
}
