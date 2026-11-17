// Fireflies and dust motes: one instanced draw of camera-facing quads (src/gl/fireflies.ts writes aFly per frame).
uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;

in vec2 position;      // corner -1..1
in vec4 aFly;          // x, y, z, brightness (0 hides it)
in vec2 aLook;         // world size, kind (0 firefly, 1 mote)

out vec2 vCorner;
out float vBright;
out float vKind;

// Screen radius cap (NDC height): a firefly near the lens stays a small point, never a bokeh disc.
const float MAX_NDC = 0.009;

void main() {
  vec4 centre = uViewProj * vec4(aFly.xyz, 1.0);
  vec4 up = uViewProj * vec4(aFly.xyz + uCamUp * aLook.x, 1.0);
  float w = max(centre.w, 1e-3);
  float k = min(1.0, MAX_NDC / max(abs(up.y / max(up.w, 1e-3) - centre.y / w), 1e-6));
  vec3 world = aFly.xyz + (uCamRight * position.x + uCamUp * position.y) * aLook.x * k;
  vCorner = position;
  vBright = aFly.w;
  vKind = aLook.y;
  gl_Position = aFly.w > 0.0 && centre.w > 0.0 ? uViewProj * vec4(world, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
