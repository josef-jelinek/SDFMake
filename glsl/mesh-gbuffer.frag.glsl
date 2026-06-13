#version 300 es

precision highp float;

in vec3 v_normal;
in vec3 v_world_position;

uniform vec3 u_camera_position;
uniform int u_mesh_mode;

out vec4 out_normal;

#define MESH_MODE_GRID 3

/* The grid plane fades by world distance and camera side. Encoding the same
   visibility into alpha lets the AO pass ignore ground pixels after fade-out. */
float grid_plane_fill_visibility(vec3 world_position) {
    float top_view = step(0.0, u_camera_position.z);
    float grid_distance = length(world_position.xy);
    float grid_fade = 1.0 - smoothstep(1000.0, 1600.0, grid_distance);

    return top_view * grid_fade;
}

void main() {
    vec3 normal = normalize(v_normal);
    vec3 view_direction = normalize(u_camera_position - v_world_position);
    float visibility = 1.0;

    if (u_mesh_mode == MESH_MODE_GRID) {
        visibility = grid_plane_fill_visibility(v_world_position);

        if (visibility <= 0.001) {
            discard;
        }

        normal = vec3(0.0, 0.0, 1.0);
    } else {
        /* Meshes from different triangulators may not share winding conventions.
           AO is more stable if the encoded normal faces the visible side. */
        if (dot(normal, view_direction) < 0.0) {
            normal = -normal;
        }
    }

    /* RGB stores the normal remapped to texture range. Alpha is a visibility
       multiplier, not opacity for final color, and is consumed by the AO pass. */
    out_normal = vec4(normal * 0.5 + 0.5, visibility);
}
