#version 300 es

precision highp float;

in vec3 v_color;
in vec3 v_normal;
in vec3 v_world_position;

uniform vec3 u_camera_position;
uniform int u_mesh_mode;
uniform float u_alpha;
uniform float u_bounds_size;

out vec4 out_color;

#define GRID_CELL_SIZE 10.0
#define MESH_MODE_WIREFRAME 0
#define MESH_MODE_TRIANGLES 1
#define MESH_MODE_SHADED 2
#define MESH_MODE_GRID 3
#define DISPLAY_EXPOSURE 1.0

/* Match the SDF shader's world-up sky so switching preview modes does not
   change the perceived horizon or scene orientation. */
vec3 sky_background(vec3 ray_direction) {
    float t = smoothstep(0.0, 1.0, max(ray_direction.z, 0.0));
    return mix(vec3(0.5, 0.8, 1.0), vec3(0.1, 0.5, 1.0), t);
}

/* Mesh lighting is accumulated in linear space and converted once at output.
   This keeps the forward mesh pass aligned with Solid preview tonemapping. */
vec3 linear_to_srgb(vec3 color) {
    vec3 linear_color = clamp(color, 0.0, 1.0);
    vec3 low = linear_color * 12.92;
    vec3 high = pow(linear_color, vec3(0.41666666667)) * 1.055 - vec3(0.055);
    vec3 use_high = step(vec3(0.0031308), linear_color);

    return mix(low, high, use_high);
}

/* Exposure tone mapping is intentionally the same as the SDF shaders so mesh
   and ray-marched previews can be compared by geometry instead of display math. */
vec3 display_color(vec3 color) {
    vec3 mapped = vec3(1.0) - exp(-max(color, vec3(0.0)) * DISPLAY_EXPOSURE);

    return linear_to_srgb(mapped);
}

/* Derivative-filtered grid lines prevent the mesh ground plane from darkening
   into a dense pattern near the horizon. */
float grid_line(vec2 point, float cell_size) {
    vec2 coord = point / cell_size;
    vec2 width = max(fwidth(coord), vec2(0.0001));
    vec2 grid = abs(fract(coord - 0.5) - 0.5) / width;
    return 1.0 - min(min(grid.x, grid.y), 1.0);
}

/* The shaded bounds footprint is only a context cue for the configured
   triangulation volume, so it fades with the same derivative width as the grid. */
float bounds_area_mask(vec2 point) {
    float half_size = max(u_bounds_size, 0.0) * 0.5;
    vec2 edge_distance = vec2(half_size) - abs(point);
    float min_edge_distance = min(edge_distance.x, edge_distance.y);
    float edge_width = max(length(fwidth(point)), 0.5);

    if (half_size <= 0.0) {
        return 0.0;
    }

    return smoothstep(0.0, edge_width, min_edge_distance);
}

/* The grid pass writes already-composited color over sky, so premultiplied
   overlay math avoids line halos over the opaque ground fill. */
vec3 over_premul(vec3 base, vec3 premul_color, float alpha) {
    return premul_color + base * (1.0 - alpha);
}

/* Grid geometry is rendered by the normal mesh pipeline, but it should look like
   the SDF overlay: visible from above, transparent from below, and sky-colored
   where the ground fades out. */
vec4 grid_plane_color(vec3 world_position) {
    float top_view = step(0.0, u_camera_position.z);
    float grid_distance = length(world_position.xy);
    float grid_fade = 1.0 - smoothstep(1000.0, 1600.0, grid_distance);
    float minor_grid = grid_line(world_position.xy, GRID_CELL_SIZE);
    float major_grid = grid_line(world_position.xy, GRID_CELL_SIZE * 5.0);
    float fill_alpha = top_view * grid_fade;
    float minor_alpha = minor_grid * grid_fade * 0.20;
    float major_alpha = major_grid * grid_fade * 0.43;
    float grid_alpha = max(fill_alpha, max(minor_alpha, major_alpha));
    float bounds_alpha = bounds_area_mask(world_position.xy) * fill_alpha * 0.08;
    vec3 ray_direction = normalize(world_position - u_camera_position);
    vec3 color = sky_background(ray_direction);

    if (grid_alpha <= 0.001) {
        return vec4(0.0);
    }

    color = over_premul(color, vec3(0.25) * fill_alpha, fill_alpha);
    color = over_premul(color, vec3(0.0), bounds_alpha);
    color = over_premul(color, vec3(0.0), minor_alpha);
    color = over_premul(color, vec3(0.0), major_alpha);

    return vec4(display_color(color), 1.0);
}

/* The material response mirrors the SDF object material. The facing term gives
   flat triangulated surfaces a similar body to smoothly estimated SDF normals. */
vec3 object_material(vec3 base_color, vec3 normal, vec3 view_direction) {
    float facing = clamp(dot(normal, view_direction), 0.0, 1.0);

    return base_color * mix(0.82, 1.08, facing);
}

/* This pass intentionally omits AO. AO is composed as a separate screen-space
   darkening layer so the forward pass keeps normal MSAA-style triangle edges. */
vec3 object_lighting(vec3 base_color, vec3 normal, vec3 view_direction) {
    vec3 sun_direction = normalize(vec3(0.769615, -0.133013, 0.4));
    vec3 back_direction = normalize(vec3(0.55, 0.20, 0.35));
    vec3 half_vector = normalize(sun_direction + view_direction);
    vec3 material = object_material(base_color, normal, view_direction);
    float sun_diffuse = max(dot(normal, sun_direction), 0.0);
    float sky_diffuse = sqrt(clamp(0.5 + 0.5 * normal.z, 0.0, 1.0));
    float back_diffuse = max(dot(normal, back_direction), 0.0);
    float sun_fresnel = 0.04 + 0.96 * pow(clamp(1.0 - dot(half_vector, sun_direction), 0.0, 1.0), 5.0);
    float sun_specular = pow(max(dot(normal, half_vector), 0.0), 16.0) * sun_diffuse * sun_fresnel;
    vec3 sky_diffuse_color = sky_background(normal);
    vec3 color = material * 0.18;
    float view_fill = clamp(1.0 - dot(normal, view_direction), 0.0, 1.0);

    color += material * sun_diffuse * vec3(1.34, 1.08, 0.78) * 1.38;
    color += material * sky_diffuse * sky_diffuse_color * 0.56;
    color += material * back_diffuse * vec3(0.40) * 0.42;
    color += vec3(1.30, 1.00, 0.70) * sun_specular;
    color += material * view_fill * view_fill * 0.16;

    return color;
}

void main() {
    vec3 normal = normalize(v_normal);
    vec3 view_direction = normalize(u_camera_position - v_world_position);
    vec3 color = vec3(0.02);
    vec4 grid_color = vec4(0.0);

    if (u_mesh_mode == MESH_MODE_GRID) {
        /* The grid is drawn as a separate mesh draw, but discarded where the SDF
           preview would have faded it completely. */
        grid_color = grid_plane_color(v_world_position);

        if (grid_color.a <= 0.001) {
            discard;
        }

        out_color = grid_color;
        return;
    }

    if (u_mesh_mode == MESH_MODE_TRIANGLES || u_mesh_mode == MESH_MODE_SHADED) {
        /* Exported and reduced meshes may contain either winding at the visible
           surface, so flip normals toward the camera for stable preview shading. */
        if (dot(normal, view_direction) < 0.0) {
            normal = -normal;
        }
    }

    if (u_mesh_mode == MESH_MODE_TRIANGLES) {
        color = object_lighting(v_color, normal, view_direction);
    }

    if (u_mesh_mode == MESH_MODE_SHADED) {
        color = object_lighting(vec3(0.45, 0.26, 0.025), normal, view_direction);
    }

    out_color = vec4(display_color(color) * u_alpha, u_alpha);
}
