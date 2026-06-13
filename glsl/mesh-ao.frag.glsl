#version 300 es

precision highp float;

out vec4 out_color;

uniform vec2 u_resolution;
uniform mat4 u_matrix;
uniform mat4 u_inverse_matrix;
uniform vec3 u_camera_position;
uniform float u_bounds_size;
uniform sampler2D u_normal_texture;
uniform sampler2D u_depth_texture;

#define AO_SAMPLE_COUNT 36
#define AO_RADIUS 5.0
#define AO_BIAS 0.18
#define AO_STRENGTH 3.0
#define AO_MIN_VALUE 0.0

/* Normals are packed into color for the G-buffer. Alpha is reserved for surface
   visibility so the ground plane can fade out without contributing AO forever. */
vec3 decode_normal(vec4 encoded_normal) {
    return normalize(encoded_normal.rgb * 2.0 - 1.0);
}

/* Depth is sampled from the hardware depth buffer, then unprojected through the
   inverse view-projection matrix. AO uses world distances in millimeters so it
   remains independent of camera zoom. */
vec3 reconstruct_world_position(vec2 uv, float depth) {
    vec4 clip_position = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 world_position = u_inverse_matrix * clip_position;

    return world_position.xyz / world_position.w;
}

/* The rotation is screen-space on purpose: it decorrelates neighboring pixels,
   then the blur pass removes the pattern without tying noise to model movement. */
float ambient_occlusion_rotation(vec2 pixel) {
    return fract(sin(dot(pixel, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
}

/* Samples are biased toward the center of the radius because small creases and
   contact points are more important than distant broad occlusion in this app. */
float ambient_occlusion_sample_scale(int sample_index) {
    float index = (float(sample_index) + 1.0) / float(AO_SAMPLE_COUNT);

    return mix(0.04, 1.0, pow(index, 1.65));
}

/* Directions form a wide hemisphere around the surface normal. The flattened
   local z keeps the AO spread broad enough to resemble the SDF normal-sample AO
   while still checking nearby side features. */
vec3 ambient_occlusion_sample_direction(int sample_index, float rotation, vec3 tangent, vec3 bitangent, vec3 normal) {
    float index = (float(sample_index) + 0.5) / float(AO_SAMPLE_COUNT);
    float angle = float(sample_index) * 2.39996323 + rotation;
    float disk_radius = pow(index, 0.32);
    float local_z = sqrt(max(1.0 - disk_radius * disk_radius, 0.0)) * 0.72;
    vec3 direction = tangent * cos(angle) * disk_radius
        + bitangent * sin(angle) * disk_radius
        + normal * local_z;

    return normalize(direction);
}

/* AO probes are generated in world space, then projected back to the G-buffer.
   Samples outside the viewport are ignored instead of clamped, which avoids
   false occlusion at screen edges. */
float project_world_position(vec3 position, out vec2 uv) {
    vec4 clip_position = u_matrix * vec4(position, 1.0);

    if (clip_position.w <= 0.0001) {
        return 0.0;
    }

    uv = clip_position.xy / clip_position.w * 0.5 + 0.5;

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return 0.0;
    }

    return 1.0;
}

/* Empty depth or faded grid pixels should not darken nearby surfaces. The alpha
   test is also what makes the ground AO disappear past the horizon fade. */
float valid_sample(vec4 encoded_normal, float depth) {
    if (encoded_normal.a <= 0.01 || depth >= 0.999999) {
        return 0.0;
    }

    return 1.0;
}

/* Ground-plane AO is limited near the modeling volume. Without this guard, the
   infinite ground mesh can accumulate subtle darkening at very shallow angles. */
float ambient_occlusion_visibility(vec3 position) {
    float near_radius = max(u_bounds_size, 1.0);
    float far_radius = near_radius * 2.0;
    float distance_from_origin = length(position.xy);

    return 1.0 - smoothstep(near_radius, far_radius, distance_from_origin);
}

/* The G-buffer pass cannot ask the SDF for true distance, so each world-space
   probe projects into the rendered depth buffer and compares expected probe
   depth with the closest visible surface along that camera ray. */
float screen_space_ambient_occlusion(vec3 position, vec3 normal) {
    vec3 tangent_seed = vec3(0.0, 0.0, 1.0);
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 bitangent = vec3(0.0, 1.0, 0.0);
    float rotation = ambient_occlusion_rotation(gl_FragCoord.xy);
    float occlusion = 0.0;
    float weight_total = 0.0;
    int sample_index = 0;

    if (abs(normal.z) > 0.82) {
        tangent_seed = vec3(1.0, 0.0, 0.0);
    }

    tangent = normalize(cross(tangent_seed, normal));
    bitangent = normalize(cross(normal, tangent));

    for (sample_index = 0; sample_index < AO_SAMPLE_COUNT; sample_index += 1) {
        float sample_scale = ambient_occlusion_sample_scale(sample_index);
        float sample_weight = 1.0 - sample_scale * 0.35;
        vec3 sample_direction = ambient_occlusion_sample_direction(sample_index, rotation, tangent, bitangent, normal);
        vec3 sample_position = position + sample_direction * AO_RADIUS * sample_scale;
        vec2 sample_uv = vec2(0.0);

        if (project_world_position(sample_position, sample_uv) > 0.5) {
            vec4 sample_encoded_normal = texture(u_normal_texture, sample_uv);
            float sample_depth = texture(u_depth_texture, sample_uv).r;

            if (valid_sample(sample_encoded_normal, sample_depth) > 0.5) {
                vec3 visible_position = reconstruct_world_position(sample_uv, sample_depth);
                vec3 ray_direction = normalize(sample_position - u_camera_position);
                vec3 visible_delta = visible_position - position;
                float sample_ray_distance = dot(sample_position - u_camera_position, ray_direction);
                float visible_ray_distance = dot(visible_position - u_camera_position, ray_direction);
                float distance_to_visible = length(visible_delta);
                float normal_distance = dot(normal, visible_delta);
                /* The weights reject far samples, surfaces behind the tangent
                   plane, and surfaces that are not actually in front of the
                   probe along the camera ray. */
                float range_weight = 1.0 - smoothstep(AO_RADIUS * 0.20, AO_RADIUS, distance_to_visible);
                float hemisphere_weight = smoothstep(0.0, AO_BIAS * 2.0, normal_distance);
                float depth_weight = smoothstep(AO_BIAS, AO_RADIUS * 0.26, sample_ray_distance - visible_ray_distance);
                float sample_visibility = ambient_occlusion_visibility(visible_position);

                occlusion += range_weight * hemisphere_weight * depth_weight * sample_weight * sample_encoded_normal.a * sample_visibility;
            }
        }

        weight_total += sample_weight;
    }

    return clamp(1.0 - occlusion / weight_total * AO_STRENGTH, AO_MIN_VALUE, 1.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec4 encoded_normal = texture(u_normal_texture, uv);
    float depth = texture(u_depth_texture, uv).r;

    if (valid_sample(encoded_normal, depth) > 0.5) {
        vec3 normal = decode_normal(encoded_normal);
        vec3 position = reconstruct_world_position(uv, depth);
        float ao = screen_space_ambient_occlusion(position, normal);
        float visibility = ambient_occlusion_visibility(position);

        out_color = vec4(0.0, 0.0, 0.0, (1.0 - ao) * encoded_normal.a * visibility);
        return;
    }

    out_color = vec4(0.0);
}
