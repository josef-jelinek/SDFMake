#version 300 es

in vec3 a_position;
in vec3 a_color;
in vec3 a_normal;

uniform mat4 u_matrix;

out vec3 v_color;
out vec3 v_normal;
out vec3 v_world_position;

void main() {
    /* Mesh data is already in world/model coordinates. The fragment shaders need
       that space for lighting, AO reconstruction comparisons, and grid fading. */
    v_color = a_color;
    v_normal = a_normal;
    v_world_position = a_position;
    gl_Position = u_matrix * vec4(a_position, 1.0);
}
