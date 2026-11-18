// The one cutout material, vertex stage. Two quads per instance (src/gl/instances.ts): kind 0 is the ground decal
// (the sprite's own alpha laid flat toward uShadowDir), kind 1 is the paper. Corner 0..1 with y up; v = 0 is the page
// bottom row, so (u0, v0) is the sprite's bottom left (cook/DOCS.md, atlas UV convention).
uniform mat4 uViewProj;
uniform float uTime;
uniform vec2 uWind;        // x: steady lean in radians, y: gust gain 0..1
uniform vec4 uCursor;
uniform vec4 uFocusBack;   // the plane the far layers fall back behind, amount
uniform vec4 uShadowDir;   // decal direction x, z on the ground; length per unit of height; opacity
uniform vec3 uEye;         // camera x, z on the ground; standee turn weight (0 on the rail, 1 under free roam)

in vec3 position;   // corner x, y; kind
in vec4 aPos;       // x, y, z, rotation (radians)
in vec4 aSize;      // w, h (world units), pivot x, pivot y (0..1 of the quad)
in vec4 aUV;        // u0, v0, u1, v1; u1 < u0 means flipped
in vec4 aAnim;      // sway amplitude (radians), phase + 8 * flags, lift, facing (hinge yaw in radians)
in vec4 aTint;      // rgb multiplier, opacity (u8 normalised)

out vec2 vUV;
out vec4 vRect;
out vec3 vWorld;
out vec4 vTint;
out vec4 vFrame;    // cos and sin of the rotation, flip sign, kind
out vec4 vOrient;   // cos and sin of the yaw, lean (radians), flat 0/1
out float vLift;
out float vDecal;   // 0 at the foot, 1 at the far end of the decal
out float vDepth;
out float vMirror;     // 1: mirrored by a negative width (winding reversed)
out float vSilhouette; // 1: the tint is the colour, uncapped (overview cards of beds not loaded)
out float vPlaneDepth; // view depth of the hand light's plane
out float vFocusDepth; // view depth of the fall-back plane (the focused flower or the bed's flowers)

const float LEAN = 0.13963;          // 8 degrees back (cook/ART.md: half the camera pitch)
const float PUSH_RADIUS = 0.6;       // the cursor's ground point bends leaves within this distance
const float PUSH_MAX = 0.2443;       // 14 degrees
const float DECAL_LIFT = 0.004;      // decals sit just above the ground they fall on
const float TURN_MAX = 0.61087;      // a standee follows the eye's bearing up to 35 degrees either side
const float TURN_K = 0.7;            // and turns this share of it, so the hinge variety stays

float bit(float flags, float b) { return mod(floor(flags / b), 2.0); }

void main() {
  float flags = floor(aAnim.y / 8.0);
  float phase = aAnim.y - flags * 8.0;
  float flat_ = bit(flags, 1.0);
  float fullRate = bit(flags, 2.0);
  float lean = (1.0 - bit(flags, 4.0)) * (1.0 - flat_) * LEAN;
  float kind = position.z;
  vec2 corner = position.xy;

  // Standees (flag 32) turn from their hinge toward the eye; weight 0 leaves the hinge exactly as it was.
  float bearing = clamp(atan(uEye.x - aPos.x, uEye.y - aPos.z), -TURN_MAX, TURN_MAX);
  float yaw = aAnim.w + bit(flags, 32.0) * uEye.z * TURN_K * bearing;
  float cy = cos(yaw);
  float sy = sin(yaw);
  vec3 right = vec3(cy, 0.0, -sy);
  vec3 front = vec3(sy, 0.0, cy);
  vec3 world;

  if (kind < 0.5) {
    // Ground decal: only for standing cutouts with the pivot at the foot.
    float casts = (1.0 - flat_) * (1.0 - bit(flags, 8.0)) * step(aSize.w, 0.1) * step(1e-4, uShadowDir.w);
    float across = (corner.x - aSize.z) * aSize.x * (1.0 + 0.35 * corner.y);
    float along = corner.y * uShadowDir.z * aSize.y;
    world = aPos.xyz + right * across + vec3(uShadowDir.x, 0.0, uShadowDir.y) * along + vec3(0.0, DECAL_LIFT - aSize.w * aSize.y, 0.0);
    vec4 clip = uViewProj * vec4(world, 1.0);
    gl_Position = casts > 0.5 ? clip : vec4(2.0, 2.0, 2.0, 1.0);
  } else {
    vec2 local = (corner - aSize.zw) * aSize.xy;
    // Sway on twos unless flagged (spec section 2), growing with height above the pivot.
    float t = fullRate > 0.5 ? uTime : floor(uTime * 12.0) / 12.0;
    float bend = max(corner.y - aSize.w, 0.0);
    float angle = aAnim.x * (sin(t * 1.3 + phase) * (0.6 + 0.4 * uWind.y) + uWind.x);
    // Leaves that sway bend away from the hand light's ground point at the full rate.
    vec2 away = aPos.xz - uCursor.xz;
    float push = step(1e-4, aAnim.x) * (1.0 - smoothstep(0.0, PUSH_RADIUS, length(away)));
    angle += sign(away.x + 1e-4) * push * PUSH_MAX;
    local.x += angle * bend * bend * aSize.y;

    float c = cos(aPos.w);
    float s = sin(aPos.w);
    local = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
    if (flat_ > 0.5) {
      world = aPos.xyz + right * local.x - front * local.y + vec3(0.0, DECAL_LIFT, 0.0);
    } else {
      world = aPos.xyz + right * local.x + vec3(0.0, local.y * cos(lean), 0.0) - front * (local.y * sin(lean));
    }
    gl_Position = uViewProj * vec4(world, 1.0);
  }

  vUV = mix(aUV.xy, aUV.zw, corner);
  vRect = vec4(min(aUV.x, aUV.z), min(aUV.y, aUV.w), max(aUV.x, aUV.z), max(aUV.y, aUV.w));
  vWorld = world;
  vTint = aTint;
  vSilhouette = bit(flags, 16.0);
  vMirror = step(aSize.x, 0.0);
  vFrame = vec4(cos(aPos.w), sin(aPos.w), aUV.z < aUV.x ? -1.0 : 1.0, kind);
  vOrient = vec4(cy, sy, lean, flat_);
  vLift = aAnim.z;
  vDecal = corner.y;
  vDepth = gl_Position.w;
  vPlaneDepth = (uViewProj * vec4(uCursor.xyz, 1.0)).w;
  vFocusDepth = (uViewProj * vec4(uFocusBack.xyz, 1.0)).w;
}
