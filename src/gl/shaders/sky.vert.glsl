// Fullscreen sky: one triangle in clip space, drawn first into the scene target.
precision highp float;

in vec2 position;
out vec2 vScreen; // 0..1 over the viewport

void main() {
  vScreen = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
