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

void main() {
  vec3 world = aFly.xyz + (uCamRight * position.x + uCamUp * position.y) * aLook.x;
  vCorner = position;
  vBright = aFly.w;
  vKind = aLook.y;
  gl_Position = aFly.w > 0.0 ? uViewProj * vec4(world, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
