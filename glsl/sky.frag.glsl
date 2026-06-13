#version 300 es

precision highp float;

in vec2 v_uv;
out vec4 out_color;

uniform vec2 u_resolution;
uniform vec3 u_camera_position;
uniform vec3 u_camera_target;
uniform vec3 u_camera_right;
uniform vec3 u_camera_up;

#define DISPLAY_EXPOSURE 1.0

/* The background pass uses the same world-up gradient as the object shaders.
   Rendering it separately gives mesh modes a clean sky before mesh and AO draws. */
vec3 sky_background(vec3 ray_direction) {
    float t = smoothstep(0.0, 1.0, max(ray_direction.z, 0.0));
    return mix(vec3(0.5, 0.8, 1.0), vec3(0.1, 0.5, 1.0), t);
}

/* This pass has no lighting, but it still uses the shared display transform so
   the background color matches SDF and mesh fragment outputs. */
vec3 linear_to_srgb(vec3 color) {
    vec3 linear_color = clamp(color, 0.0, 1.0);
    vec3 low = linear_color * 12.92;
    vec3 high = pow(linear_color, vec3(0.41666666667)) * 1.055 - vec3(0.055);
    vec3 use_high = step(vec3(0.0031308), linear_color);

    return mix(low, high, use_high);
}

vec3 display_color(vec3 color) {
    vec3 mapped = vec3(1.0) - exp(-max(color, vec3(0.0)) * DISPLAY_EXPOSURE);

    return linear_to_srgb(mapped);
}

void main() {
    /* Ray construction mirrors the SDF fullscreen shader. That keeps the sky
       gradient locked to camera orientation across all preview modes. */
    vec2 pixel = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
    vec3 forward = normalize(u_camera_target - u_camera_position);
    vec3 ray_direction = normalize(forward + pixel.x * u_camera_right + pixel.y * u_camera_up);
    out_color = vec4(display_color(sky_background(ray_direction)), 1.0);
}
