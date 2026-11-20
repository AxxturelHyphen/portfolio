// The warm pool a signpost's lantern throws on its plank (src/gl/signboards.ts), vertex stage. Same instance layout as
// the cutouts (src/gl/instances.ts), one instance per plank, placed as the cutout shader places an upright, unleaning
// quad: hinge yaw, then its rotation about the hook (the sway). Only the paper quad (kind 1) is drawn.
uniform mat4 uViewProj;

in vec3 position;   // corner x, y; kind
in vec4 aPos;       // x, y, z, rotation (radians)
in vec4 aSize;      // w, h (world units), pivot x, pivot y
in vec4 aUV;        // u0, v0, u1, v1
in vec4 aAnim;      // the flame in the plank's frame (x across, z up, 0..1), flicker phase, hinge yaw
in vec4 aTint;      // a: glow strength

out vec2 vUV;
out vec2 vQ;        // corner in the plank's frame
out vec2 vSize;
out vec2 vFlame;
out float vGlow;
out float vPhase;

void main() {
  if (position.z < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 corner = position.xy;
  vec2 local = (corner - aSize.zw) * aSize.xy;
  float c = cos(aPos.w);
  float s = sin(aPos.w);
  local = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec3 right = vec3(cos(aAnim.w), 0.0, -sin(aAnim.w));
  gl_Position = uViewProj * vec4(aPos.xyz + right * local.x + vec3(0.0, local.y, 0.0), 1.0);
  vUV = mix(aUV.xy, aUV.zw, corner);
  vQ = corner;
  vSize = abs(aSize.xy);
  vFlame = aAnim.xz;
  vGlow = aTint.a;
  vPhase = aAnim.y;
}
