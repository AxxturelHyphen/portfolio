// The one cutout material, vertex stage. Two quads per instance (src/gl/instances.ts): kind 0 is the ground decal
// (the sprite's own alpha laid flat toward uShadowDir), kind 1 is the paper. Corner 0..1 with y up; v = 0 is the page
// bottom row, so (u0, v0) is the sprite's bottom left (cook/DOCS.md, atlas UV convention).
uniform mat4 uViewProj;
uniform float uTime;
uniform vec2 uWind;        // x: steady lean in radians, y: gust gain 0..1
uniform vec4 uCursor;
uniform vec4 uFocusBack;   // the plane the far layers fall back behind, amount
uniform vec4 uShadowDir;   // decal direction x, z on the ground; length per unit of height; opacity
uniform vec3 uEye;         // z: 0 on the rail, 1 under free roam
uniform vec2 uVisitor;     // the roaming visitor's ground point x, z
uniform vec4 uPart;        // the grotto's ivy curtain: centre x, z, half width, how far it parts (metres)
uniform float uThick;      // paper edge gain: 1, or 0 on the low tier and for the actors (cutout.material.ts)
uniform float uShadowPass; // 1 while the cutouts draw the lantern's shadow map (gl/shadow.ts)

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
out vec4 vFrame;    // cos and sin of the rotation, flip sign, kind (-1: the shadow below a hung cutout)
out vec4 vOrient;   // cos and sin of the yaw, lean (radians), flat 0/1
out float vLift;
out float vDecal;   // 0 at the foot, 1 at the far end of the decal
out float vDepth;
out float vMirror;     // 1: mirrored by a negative width (winding reversed)
out float vSilhouette; // 1: the tint is the colour, uncapped (overview cards of beds not loaded)
out float vPlaneDepth; // view depth of the hand light's plane
out float vFocusDepth; // view depth of the fall-back plane (the focused flower or the bed's flowers)
out float vFade;       // paper opacity factor: under 1 while a fading card covers the visitor
out float vHung;       // 1: a hung cutout's paper (the carried lantern), lit from its own flame
out float vStone;      // 1: wall and coping stone, never weighed as a leaf
out vec4 vSide;        // the eye seen from the paper: xy in the sprite's uv frame, z along the face normal; w thickness (m)
out vec3 vSideN;       // the part of the way to the eye that lies in the face (world): the lit side of the cut edge

const float LEAN = 0.13963;          // 8 degrees back (cook/ART.md: half the camera pitch)
const float PUSH_RADIUS = 0.6;       // the cursor's ground point bends leaves within this distance
const float PUSH_MAX = 0.2443;       // 14 degrees
const float ROAM_PUSH_RADIUS = 1.2;  // under free roam leaves bend round the visitor's ground point within this distance
const float DECAL_LIFT = 0.004;      // decals sit just above the ground they fall on
// Paper thickness under free roam: a share of the card's height, between a floor and a ceiling (metres). The quad grows
// by THICK_PAD thicknesses each side so the cut edge seen past its outline has room (the fragment stage clips there).
const vec3 THICK = vec3(0.012, 0.002, 0.025);
const float THICK_PAD = 1.2;
const float FADE_TO = 0.35;          // a fading card's opacity while it covers the visitor
const float FADE_EDGE = 0.3;         // metres either side of its outline over which it fades: about 0.2 s of walking
const vec2 HUNG_SHADOW = vec2(1.5, 0.9); // a hanging cutout's shadow below it: width and depth as shares of its width
const float PART_DEPTH = 0.3;        // cards within this depth of the curtain's plane belong to it
const float FOOT_BACK = 0.25;        // free roam: the decal starts this share of its length behind the foot (its occlusion)

float bit(float flags, float b) { return mod(floor(flags / b), 2.0); }

// The eye from the view-projection: the one point whose clip x, y and w are all zero.
vec3 eyeOf(mat4 m) {
  vec4 r0 = vec4(m[0][0], m[1][0], m[2][0], m[3][0]);
  vec4 r1 = vec4(m[0][1], m[1][1], m[2][1], m[3][1]);
  vec4 r3 = vec4(m[0][3], m[1][3], m[2][3], m[3][3]);
  vec3 c01 = cross(r0.xyz, r1.xyz);
  vec3 c13 = cross(r1.xyz, r3.xyz);
  vec3 c30 = cross(r3.xyz, r0.xyz);
  return -(r0.w * c13 + r1.w * c30 + r3.w * c01) / dot(r0.xyz, c13);
}

// How far the visitor's ground point lies inside the card's outline on screen: 0 outside, 1 well inside.
float coverOf(vec3 right, vec3 front, float lean) {
  vec2 lo = vec2(1e9);
  vec2 hi = vec2(-1e9);
  for (int i = 0; i < 4; i++) {
    vec2 local = (vec2(float(i % 2), float(i / 2)) - aSize.zw) * aSize.xy;
    vec4 c = uViewProj * vec4(aPos.xyz + right * local.x + vec3(0.0, local.y * cos(lean), 0.0) - front * (local.y * sin(lean)), 1.0);
    lo = min(lo, c.xy / c.w);
    hi = max(hi, c.xy / c.w);
  }
  vec4 v = uViewProj * vec4(uVisitor.x, 0.0, uVisitor.y, 1.0);
  vec2 p = v.xy / v.w;
  float inside = min(min(p.x - lo.x, hi.x - p.x), min(p.y - lo.y, hi.y - p.y));
  float edge = FADE_EDGE * (hi.x - lo.x) / max(abs(aSize.x), 1e-3);
  return smoothstep(-edge, edge, inside);
}

void main() {
  float flags = floor(aAnim.y / 8.0);
  float phase = aAnim.y - flags * 8.0;
  float flat_ = bit(flags, 1.0);
  float fullRate = bit(flags, 2.0);
  float lean = (1.0 - bit(flags, 4.0)) * (1.0 - flat_) * LEAN;
  float kind = position.z;
  vec2 corner = position.xy;

  // Every cutout keeps its hinge: an orbiting eye sees the paper turn, its cut edge and the crossed cards.
  float yaw = aAnim.w;
  float cy = cos(yaw);
  float sy = sin(yaw);
  vec3 right = vec3(cy, 0.0, -sy);
  vec3 front = vec3(sy, 0.0, cy);
  vec3 world;
  vFade = 1.0;
  vSide = vec4(0.0);
  vSideN = vec3(0.0);

  if (kind < 0.5) {
    // Ground decal: only for standing cutouts with the pivot at the foot.
    float casts = (1.0 - flat_) * (1.0 - bit(flags, 8.0)) * step(aSize.w, 0.1) * step(1e-4, uShadowDir.w);
    corner.y -= FOOT_BACK * uEye.z * (1.0 - corner.y) * (1.0 - bit(flags, 128.0));
    float across = (corner.x - aSize.z) * aSize.x * (1.0 + 0.35 * corner.y);
    float along = corner.y * uShadowDir.z * aSize.y;
    world = aPos.xyz + right * across + vec3(uShadowDir.x, 0.0, uShadowDir.y) * along + vec3(0.0, DECAL_LIFT - aSize.w * aSize.y, 0.0);
    if (bit(flags, 128.0) > 0.5) {
      // Hung (the carried lantern): a soft patch on the ground straight below, whatever the height it hangs at.
      vec2 spread = (corner - 0.5) * abs(aSize.x) * HUNG_SHADOW;
      world = vec3(aPos.x, DECAL_LIFT, aPos.z) + right * spread.x + front * spread.y;
      kind = -1.0;
    }
    vec4 clip = uViewProj * vec4(world, 1.0);
    gl_Position = casts > 0.5 ? clip : vec4(2.0, 2.0, 2.0, 1.0);
  } else {
    float thick = uThick * uEye.z * (1.0 - flat_) * clamp(abs(aSize.y) * THICK.x, THICK.y, THICK.z);
    corner += sign(corner - 0.5) * THICK_PAD * thick / max(abs(aSize.xy), vec2(1e-3));
    vec2 local = (corner - aSize.zw) * aSize.xy;
    // Sway on twos unless flagged (spec section 2), growing with height above the pivot.
    float t = fullRate > 0.5 ? uTime : floor(uTime * 12.0) / 12.0;
    float bend = max(corner.y - aSize.w, 0.0);
    float angle = aAnim.x * (sin(t * 1.3 + phase) * (0.6 + 0.4 * uWind.y) + uWind.x);
    // Leaves that sway bend away from the hand light's ground point at the full rate.
    // Under free roam (uEye.z 1) they bend round the visitor's ground point instead, in a wider ring.
    vec2 away = aPos.xz - (uEye.z > 0.5 ? uVisitor : uCursor.xz);
    float push = step(1e-4, aAnim.x) * (1.0 - smoothstep(0.0, mix(PUSH_RADIUS, ROAM_PUSH_RADIUS, uEye.z), length(away)));
    angle += sign(away.x + 1e-4) * push * PUSH_MAX;
    local.x += angle * bend * bend * aSize.y;
    // The ivy curtain parts from its middle, most at the foot where the visitor would brush through it; stone stays.
    vec2 toPart = aPos.xz - uPart.xy;
    float inCurtain = step(abs(toPart.x), uPart.z) * step(abs(toPart.y), PART_DEPTH) * (1.0 - bit(flags, 256.0));
    local.x += inCurtain * sign(toPart.x + 1e-4) * uPart.w * (1.0 - 0.5 * corner.y);

    float c = cos(aPos.w);
    float s = sin(aPos.w);
    local = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
    if (flat_ > 0.5) {
      world = aPos.xyz + right * local.x - front * local.y + vec3(0.0, DECAL_LIFT, 0.0);
    } else {
      world = aPos.xyz + right * local.x + vec3(0.0, local.y * cos(lean), 0.0) - front * (local.y * sin(lean));
    }
    gl_Position = uViewProj * vec4(world, 1.0);
    if (thick > 0.0) {
      // The way to the eye in the face's frame: undo the lean, then the in-plane rotation, then metres to uv.
      vec3 toEye = eyeOf(uViewProj) - world;
      vec3 normal = front * cos(lean) + vec3(0.0, sin(lean), 0.0);
      vec2 e = vec2(dot(toEye, right), dot(toEye, vec3(0.0, cos(lean), 0.0) - front * sin(lean)));
      e = vec2(c * e.x + s * e.y, s * -e.x + c * e.y) / aSize.xy * (aUV.zw - aUV.xy);
      float along = dot(toEye, normal);
      vSide = vec4(e, along, thick);
      vSideN = toEye - normal * along;
    }
    if (bit(flags, 64.0) * uEye.z > 0.5) vFade = 1.0 - (1.0 - FADE_TO) * coverOf(right, front, lean);
    // A fading card keeps no depth: the figure drawn after the cutouts shows through its trace, never cut away by it.
    if (vFade < 1.0) gl_Position.z = gl_Position.w;
  }

  vHung = kind > 0.5 ? bit(flags, 128.0) : 0.0;
  // The lantern's shadow: only standing paper casts, never a decal, a flat or the hung lantern itself.
  if (uShadowPass > 0.5 && (kind < 0.5 || flat_ > 0.5 || vHung > 0.5)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUV = mix(aUV.xy, aUV.zw, corner);
  vRect = vec4(min(aUV.x, aUV.z), min(aUV.y, aUV.w), max(aUV.x, aUV.z), max(aUV.y, aUV.w));
  vWorld = world;
  vTint = aTint;
  vSilhouette = bit(flags, 16.0);
  vStone = bit(flags, 256.0);
  vMirror = step(aSize.x, 0.0);
  vFrame = vec4(cos(aPos.w), sin(aPos.w), aUV.z < aUV.x ? -1.0 : 1.0, kind);
  vOrient = vec4(cy, sy, lean, flat_);
  vLift = aAnim.z;
  vDecal = corner.y;
  vDepth = gl_Position.w;
  vPlaneDepth = (uViewProj * vec4(uCursor.xyz, 1.0)).w;
  vFocusDepth = (uViewProj * vec4(uFocusBack.xyz, 1.0)).w;
}
