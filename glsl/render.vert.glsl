#version 300 es

in vec2 a_position;
out vec2 v_uv;

void main() {
    /* Fullscreen passes provide clip-space positions directly. The fragment
       shaders reconstruct camera rays from screen coordinates, not from v_uv. */
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
