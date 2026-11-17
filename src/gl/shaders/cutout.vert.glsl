// The one cutout material, vertex stage (GLSL ES 3.00; three adds the #version line).
// One quad per instance. Corner 0..1 with y up; atlas UVs have v pointing down the image (row 0 at the top).
precision highp float;

uniform mat4 uViewProj;
uniform float uTime;
uniform vec2 uWind; // x: steady lean in radians, y: gust gain 0..1

in vec2 position;   // quad corner, 0..1
in vec4 aPos;       // x, y, z, rotation (radians)
in vec4 aSize;      // w, h (world units), pivot x, pivot y (0..1 of the quad)
in vec4 aUV;        // u0, v0 (bottom left), u1, v1 (top right); v = 0 is the page bottom row; u1 < u0 means flipped
in vec4 aAnim;      // sway amplitude (radians), sway phase, lift, facing (yaw in radians)
in vec4 aTint;      // rgb multiplier, opacity (u8 normalised)

out vec2 vUV;
out vec4 vRect;
out vec3 vWorld;
out vec4 vTint;
out vec3 vFrame;    // cos and sin of the rotation, flip sign: turns normal-map xy into world xy
out float vLift;

void main() {
  vec2 local = (position - aSize.zw) * aSize.xy;

  // Sway on twos (spec section 2): content time stepped to 12 fps, bend grows with height above the pivot.
  float stepped = floor(uTime * 12.0) / 12.0;
  float bend = max(position.y - aSize.w, 0.0);
  float angle = aAnim.x * (sin(stepped * 1.3 + aAnim.y) * (0.6 + 0.4 * uWind.y) + uWind.x);
  local.x += angle * bend * bend * aSize.y;

  float c = cos(aPos.w);
  float s = sin(aPos.w);
  local = vec2(c * local.x - s * local.y, s * local.x + c * local.y);

  float cy = cos(aAnim.w);
  float sy = sin(aAnim.w);
  vec3 world = aPos.xyz + vec3(local.x * cy, local.y, -local.x * sy);

  vUV = mix(aUV.xy, aUV.zw, position);
  vRect = vec4(min(aUV.x, aUV.z), min(aUV.y, aUV.w), max(aUV.x, aUV.z), max(aUV.y, aUV.w));
  vWorld = world;
  vTint = aTint;
  vFrame = vec3(c, s, aUV.z < aUV.x ? -1.0 : 1.0);
  vLift = aAnim.z;
  gl_Position = uViewProj * vec4(world, 1.0);
}
