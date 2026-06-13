#version 300 es

precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform vec2 u_resolution;
uniform vec3 u_camera_position;
uniform vec3 u_camera_target;
uniform vec3 u_camera_right;
uniform vec3 u_camera_up;
uniform float u_bounds_size;
uniform float u_show_bounds_wire;

/* These limits are tuned for millimeter-scale models. Marching uses a
   conservative step scale because generated SDF expressions can include
   blends and chamfers that are not perfect distance fields at every point. */
#define MAX_STEPS 240
#define HIT_REFINE_STEPS 12
#define FALLBACK_MAX_DISTANCE 2000.0
#define SURFACE_DISTANCE 0.04
#define RAY_STEP_SCALE 0.70710678118
#define GRID_CELL_SIZE 10.0
/* Photo mode keeps expensive effects separate from the interactive preview.
   AA is compile-time so the common one-sample path has no dynamic branch. */
#define PHOTO_AA 1
#define PHOTO_SHADOW_STEPS 14
#define PHOTO_AO_STEPS 5
#define PHOTO_AO_START_DISTANCE 0.2
#define PHOTO_AO_END_DISTANCE 5.0
#define PHOTO_AO_REFERENCE_UNIT_MM 50.0
#define PHOTO_FOG_DENSITY 0.00000001
#define PHOTO_FOG_MAX 0.5
#define DISPLAY_EXPOSURE 1.0

#ifndef SDFMAKE_PHOTO_MODE
#define SDFMAKE_PHOTO_MODE 0
#endif

float safe_inverse(float value);
vec2 box_hit_range(vec3 ray_origin, vec3 ray_direction, vec3 box_min, vec3 box_max);
float grid_line(vec2 point, float cell_size);
float plane_hit_distance(vec3 ray_origin, vec3 ray_direction);

/* The sky is tied to world-space up rather than screen space. Orbiting the
   camera therefore keeps the horizon stable across SDF and mesh previews. */
vec3 sky_background(vec3 ray_direction) {
    float t = smoothstep(0.0, 1.0, max(ray_direction.z, 0.0));
    return mix(vec3(0.5, 0.8, 1.0), vec3(0.1, 0.5, 1.0), t);
}

/* Lighting is accumulated in linear space. Conversion is delayed until the end
   so diffuse, specular, AO, fog, and overlays combine predictably. */
vec3 linear_to_srgb(vec3 color) {
    vec3 linear_color = clamp(color, 0.0, 1.0);
    vec3 low = linear_color * 12.92;
    vec3 high = pow(linear_color, vec3(0.41666666667)) * 1.055 - vec3(0.055);
    vec3 use_high = step(vec3(0.0031308), linear_color);

    return mix(low, high, use_high);
}

/* Exposure tone mapping gives a single constant for balancing the solid, photo,
   and mesh previews before the final sRGB transform. */
vec3 display_color(vec3 color) {
    vec3 mapped = vec3(1.0) - exp(-max(color, vec3(0.0)) * DISPLAY_EXPOSURE);

    return linear_to_srgb(mapped);
}

/* The primitive SDFs are the vocabulary emitted by the script compiler. Their
   argument conventions stay close to the scripting language, with sizes already
   converted to half extents where the generated code needs them. */
float sd_sphere(vec3 p, float radius) {
    return length(p) - radius;
}

float sd_box(vec3 p, vec3 size) {
    vec3 q = abs(p) - size;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sd_box_frame(vec3 p, vec3 size, float thickness) {
    float e = max(thickness, 0.0);
    vec3 q = vec3(0.0);
    p = abs(p) - size;
    q = abs(p + e) - e;
    return min(
        min(
            length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
            length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)
        ),
        length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0)
    );
}

float sd_rounded_box(vec3 p, vec3 size, float radius) {
    float r = clamp(radius, 0.0, min(size.x, min(size.y, size.z)));
    vec3 q = abs(p) - size + vec3(r);
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sd_chamfer_box(vec3 p, vec3 size, float chamfer) {
    float c = clamp(chamfer, 0.0, min(size.x, min(size.y, size.z)));
    vec3 q = abs(p) - size;
    float d = sd_box(p, size);

    if (c > 0.0) {
        d = max(d, (q.x + q.y + c) * 0.70710678118);
        d = max(d, (q.x + q.z + c) * 0.70710678118);
        d = max(d, (q.y + q.z + c) * 0.70710678118);
    }

    return d;
}

float sd_cylinder(vec3 p, float radius, float height) {
    vec2 q = vec2(length(p.xy) - radius, abs(p.z) - height);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float sd_rounded_cylinder(vec3 p, float radius, float height, float edge_radius) {
    float r = clamp(edge_radius, 0.0, min(radius, height));
    vec2 q = vec2(length(p.xy) - radius + r, abs(p.z) - height + r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sd_chamfer_cylinder(vec3 p, float radius, float height, float chamfer) {
    float c = clamp(chamfer, 0.0, min(radius, height));
    vec2 q = vec2(length(p.xy) - radius, abs(p.z) - height);
    float d = sd_cylinder(p, radius, height);

    if (c > 0.0) {
        d = max(d, (q.x + q.y + c) * 0.70710678118);
    }

    return d;
}

float sd_tri_prism(vec3 p, float radius, float height) {
    float prism_radius = max(radius, 0.0001);
    float half_height = max(abs(height), 0.0);
    float k = sqrt(3.0);
    float h = prism_radius * 0.5 * k;
    float d1 = 0.0;
    float d2 = 0.0;
    p.xy /= h;
    p.x = abs(p.x) - 1.0;
    p.y += 1.0 / k;

    if (p.x + k * p.y > 0.0) {
        p.xy = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;
    }

    p.x -= clamp(p.x, -2.0, 0.0);
    d1 = length(p.xy) * sign(-p.y) * h;
    d2 = abs(p.z) - half_height;
    return length(max(vec2(d1, d2), 0.0)) + min(max(d1, d2), 0.0);
}

float sd_hex_prism(vec3 p, float radius, float height) {
    vec3 k = vec3(-0.8660254, 0.5, 0.57735);
    float prism_radius = max(radius, 0.0);
    float half_height = max(abs(height), 0.0);
    vec2 d = vec2(0.0);
    p = abs(p);
    p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
    d = vec2(
        length(p.xy - vec2(clamp(p.x, -k.z * prism_radius, k.z * prism_radius), prism_radius)) * sign(p.y - prism_radius),
        p.z - half_height
    );
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sd_octagon_prism(vec3 p, float radius, float height) {
    vec3 k = vec3(-0.9238795325, 0.3826834323, 0.4142135623);
    float prism_radius = max(radius, 0.0);
    float half_height = max(abs(height), 0.0);
    vec2 d = vec2(0.0);
    p = abs(p);
    p.xy -= 2.0 * min(dot(vec2(k.x, k.y), p.xy), 0.0) * vec2(k.x, k.y);
    p.xy -= 2.0 * min(dot(vec2(-k.x, k.y), p.xy), 0.0) * vec2(-k.x, k.y);
    p.xy -= vec2(clamp(p.x, -k.z * prism_radius, k.z * prism_radius), prism_radius);
    d = vec2(length(p.xy) * sign(p.y), p.z - half_height);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sd_cone(vec3 p, float height, float base_radius, float top_radius) {
    float h = max(abs(height), 0.0001);
    float br = max(base_radius, 0.0);
    float tr = max(top_radius, 0.0);
    float half_height = h * 0.5;
    vec2 q = vec2(length(p.xy), p.z - half_height);
    vec2 k1 = vec2(tr, half_height);
    vec2 k2 = vec2(tr - br, h);
    float cap_radius = tr;

    if (q.y < 0.0) {
        cap_radius = br;
    }

    vec2 ca = vec2(q.x - min(q.x, cap_radius), abs(q.y) - half_height);
    vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / max(dot(k2, k2), 0.0001), 0.0, 1.0);
    float side = 1.0;

    if (cb.x < 0.0 && ca.y < 0.0) {
        side = -1.0;
    }

    return side * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

float sd_pyramid(vec3 p, float height, float base_size) {
    float h = max(abs(height), 0.0001);
    float half_size = max(base_size, 0.0) * 0.5;
    float slope = half_size / h;
    float side_scale = sqrt(1.0 + slope * slope);
    float side_x = (abs(p.x) + slope * p.z - half_size) / side_scale;
    float side_y = (abs(p.y) + slope * p.z - half_size) / side_scale;
    return max(-p.z, max(side_x, side_y));
}

float sd_octahedron(vec3 p, float size) {
    float s = max(size, 0.0);
    float m = 0.0;
    float k = 0.0;
    vec3 q = vec3(0.0);
    p = abs(p);
    m = p.x + p.y + p.z - s;

    if (3.0 * p.x < m) {
        q = p.xyz;
    } else if (3.0 * p.y < m) {
        q = p.yzx;
    } else if (3.0 * p.z < m) {
        q = p.zxy;
    } else {
        return m * 0.57735027;
    }

    k = clamp(0.5 * (q.z - q.y + s), 0.0, s);
    return length(vec3(q.x, q.y - s + k, q.z - k));
}

float sd_rounded_cone(vec3 p, float height, float base_radius, float top_radius, float edge_radius) {
    float h = max(abs(height), 0.0001);
    float br = max(base_radius, 0.0);
    float tr = max(top_radius, 0.0);
    float slope = (tr - br) / h;
    float side_scale = sqrt(1.0 + slope * slope);
    float r = clamp(edge_radius, 0.0, min(h * 0.5, max(br, tr)));
    float inner_base = max(br + slope * r - r * side_scale, 0.0);
    float inner_top = max(tr - slope * r - r * side_scale, 0.0);
    return sd_cone(p - vec3(0.0, 0.0, r), h - r * 2.0, inner_base, inner_top) - r;
}

float cone_side_distance(vec3 p, float height, float base_radius, float top_radius) {
    float h = max(abs(height), 0.0001);
    float br = max(base_radius, 0.0);
    float tr = max(top_radius, 0.0);
    float slope = (tr - br) / h;
    float side_scale = sqrt(1.0 + slope * slope);
    float z = clamp(p.z, 0.0, h);
    float radius_at_z = br + slope * z;

    return (length(p.xy) - radius_at_z) / side_scale;
}

float sd_chamfer_cone(vec3 p, float height, float base_radius, float top_radius, float chamfer) {
    float h = max(abs(height), 0.0001);
    float br = max(base_radius, 0.0);
    float tr = max(top_radius, 0.0);
    float c = clamp(chamfer, 0.0, min(h * 0.5, max(br, tr)));
    float d = sd_cone(p, h, br, tr);
    float side = cone_side_distance(p, h, br, tr);
    float base = -p.z;
    float top = p.z - h;

    if (c > 0.0) {
        d = max(d, (side + base + c) * 0.70710678118);
        d = max(d, (side + top + c) * 0.70710678118);
    }

    return d;
}

float sd_torus(vec3 p, float major_radius, float minor_radius) {
    vec2 q = vec2(length(p.xy) - major_radius, p.z);
    return length(q) - minor_radius;
}

float positive_mod(float value, float divisor) {
    return value - divisor * floor(value / divisor);
}

float circular_angle_distance(float a, float b) {
    float full_turn = 6.28318530718;
    float half_turn = 3.14159265359;
    float delta = positive_mod(a - b + half_turn, full_turn) - half_turn;
    return abs(delta);
}

float nearest_arc_angle(float angle, float start_angle, float sweep_angle) {
    float full_turn = 6.28318530718;
    float sweep = clamp(abs(sweep_angle), 0.0, full_turn);
    float relative = positive_mod(angle - start_angle, full_turn);
    float end_angle = start_angle + sweep;
    float start_distance = 0.0;
    float end_distance = 0.0;

    if (sweep_angle < 0.0) {
        relative = positive_mod(start_angle - angle, full_turn);
        end_angle = start_angle - sweep;
    }

    if (relative <= sweep) {
        if (sweep_angle < 0.0) {
            return start_angle - relative;
        }

        return start_angle + relative;
    }

    start_distance = circular_angle_distance(angle, start_angle);
    end_distance = circular_angle_distance(angle, end_angle);

    if (start_distance <= end_distance) {
        return start_angle;
    }

    return end_angle;
}

float sd_capped_torus(vec3 p, float major_radius, float minor_radius, float start_degrees, float sweep_degrees) {
    float start_angle = radians(start_degrees);
    float sweep_angle = radians(sweep_degrees);
    float nearest_angle = nearest_arc_angle(atan(p.y, p.x), start_angle, sweep_angle);
    vec2 nearest = vec2(cos(nearest_angle), sin(nearest_angle)) * major_radius;
    vec3 q = vec3(p.xy - nearest, p.z);

    if (abs(sweep_angle) >= 6.28308530718) {
        return sd_torus(p, major_radius, minor_radius);
    }

    return length(q) - minor_radius;
}

float sd_capped_cylinder(vec3 p, vec3 start_point, vec3 end_point, float radius) {
    vec3 pa = p - start_point;
    vec3 ba = end_point - start_point;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
    return length(pa - ba * h) - radius;
}

float sd_capped_cone(vec3 p, vec3 start_point, vec3 end_point, float start_radius, float end_radius) {
    vec3 ba = end_point - start_point;
    vec3 pa = p - start_point;
    float safe_start_radius = max(start_radius, 0.0);
    float safe_end_radius = max(end_radius, 0.0);
    float radius_delta = safe_end_radius - safe_start_radius;
    float baba = max(dot(ba, ba), 0.0001);
    float papa = dot(pa, pa);
    float paba = dot(pa, ba) / baba;
    float radial = sqrt(max(papa - paba * paba * baba, 0.0));
    float cap_x = max(0.0, radial);
    float cap_y = abs(paba - 0.5) - 0.5;
    float k = radius_delta * radius_delta + baba;
    float f = clamp((radius_delta * (radial - safe_start_radius) + paba * baba) / k, 0.0, 1.0);
    float side_x = radial - safe_start_radius - f * radius_delta;
    float side_y = paba - f;
    float sign_value = 1.0;

    if (paba < 0.5) {
        cap_x = max(0.0, radial - safe_start_radius);
    } else {
        cap_x = max(0.0, radial - safe_end_radius);
    }

    if (side_x < 0.0 && cap_y < 0.0) {
        sign_value = -1.0;
    }

    return sign_value * sqrt(min(cap_x * cap_x + cap_y * cap_y * baba, side_x * side_x + side_y * side_y * baba));
}

float op_smooth_union(float a, float b, float radius) {
    float k = max(radius, 0.0001);
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k * 0.1666667;
}

/* Chamfer operators use the same radius convention as the editor syntax. The
   sqrt(1/2) factor converts the two-field offset into a diagonal plane distance
   so operation radii match chamfered primitive radii. */
float op_chamfer_union(float a, float b, float radius) {
    return min(min(a, b), (a + b - radius) * 0.70710678118);
}

float op_chamfer_intersect(float a, float b, float radius) {
    return max(max(a, b), (a + b + radius) * 0.70710678118);
}

float op_chamfer_subtract(float a, float b, float radius) {
    return op_chamfer_intersect(a, -b, radius);
}

vec3 rotate_point(vec3 p, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}

/* The JavaScript compiler replaces only this region. Keeping the support
   functions outside it lets the app rebuild the scene without reloading the
   rest of the shader source. */
/* SDFMAKE_SCENE_START */
float scene_sdf(vec3 p) {
    return sd_box(p - vec3(0.0, 0.0, 25.0), vec3(25.0));
}
/* SDFMAKE_SCENE_END */

/* The probe distance is larger than the hit epsilon. It suppresses shader-only
   normal noise while still preserving millimeter-scale chamfers and blends. */
vec3 estimate_normal(vec3 p) {
    vec3 normal = vec3(0.0);
    vec3 e = vec3(0.0);
    int probe_index = 0;

    for (probe_index = 0; probe_index < 4; probe_index += 1) {
        e = 0.5773 * (2.0 * vec3(
            float(((probe_index + 3) >> 1) & 1),
            float((probe_index >> 1) & 1),
            float(probe_index & 1)
        ) - 1.0);
        normal += e * scene_sdf(p + 0.15 * e);
    }

    return normalize(normal);
}

/* The selected volume defines the expected object extent, and the far-side
   padding protects silhouettes near the back face when the camera is fully
   zoomed out. */
vec2 trace_distance_range(vec3 ray_origin, vec3 ray_direction) {
    float volume_size = max(u_bounds_size, 0.0);
    float half_size = volume_size * 0.5;
    vec3 box_min = vec3(-half_size, -half_size, 0.0);
    vec3 box_max = vec3(half_size, half_size, volume_size);
    vec2 hit_range = box_hit_range(ray_origin, ray_direction, box_min, box_max);
    float padding = max(volume_size * 0.12, 20.0);

    if (volume_size <= 0.0) {
        return vec2(0.0, FALLBACK_MAX_DISTANCE);
    }

    if (hit_range.y >= max(hit_range.x, 0.0)) {
        return vec2(max(hit_range.x, 0.0), hit_range.y + padding);
    }

    return vec2(0.0);
}

/* When the scaled march crosses into the object, binary refinement recovers a
   stable surface point instead of shading from inside the model. */
float refine_surface_hit(vec3 ray_origin, vec3 ray_direction, float outside_travel, float inside_travel) {
    float low = outside_travel;
    float high = inside_travel;
    int refine_index = 0;

    for (refine_index = 0; refine_index < HIT_REFINE_STEPS; refine_index += 1) {
        float mid = (low + high) * 0.5;
        float distance_to_scene = scene_sdf(ray_origin + ray_direction * mid);

        if (distance_to_scene < 0.0) {
            high = mid;
        } else {
            low = mid;
        }
    }

    return (low + high) * 0.5;
}

/* This is sphere tracing rather than fixed-step ray marching. The distance
   field controls step length, while the scaled step and refinement handle
   generated SDFs that are useful for modeling but not always exact distances. */
float trace_scene(vec3 ray_origin, vec3 ray_direction) {
    vec2 trace_range = trace_distance_range(ray_origin, ray_direction);
    float travel = trace_range.x;
    float previous_travel = travel;
    float max_distance = trace_range.y;
    int step_index = 0;

    if (max_distance <= travel) {
        return -1.0;
    }

    for (step_index = 0; step_index < MAX_STEPS; step_index += 1) {
        vec3 p = ray_origin + ray_direction * travel;
        float distance_to_scene = scene_sdf(p);

        if (distance_to_scene < 0.0) {
            if (step_index == 0) {
                return travel;
            }

            return refine_surface_hit(ray_origin, ray_direction, previous_travel, travel);
        }

        if (distance_to_scene < SURFACE_DISTANCE) {
            return travel;
        }

        previous_travel = travel;
        travel += distance_to_scene * RAY_STEP_SCALE;

        if (travel > max_distance) {
            break;
        }
    }

    return -1.0;
}

/* AO and shadows need the object and ground to occlude each other. Folding the
   ground plane into the field keeps contact shadows consistent on both sides. */
float scene_occluder_sdf(vec3 p) {
    return min(scene_sdf(p), p.z);
}

#if SDFMAKE_PHOTO_MODE
/* Photo mode samples neighboring rays for ground filtering, so it keeps camera
   ray construction in a helper shared by the main and differential samples. */
vec3 photo_ray_direction(vec2 frag_coord) {
    vec2 pixel = (frag_coord * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
    vec3 forward = normalize(u_camera_target - u_camera_position);

    return normalize(forward + pixel.x * u_camera_right + pixel.y * u_camera_up);
}

/* A small bounded march toward the light estimates penumbra width. Nearby
   blockers reduce the ratio more aggressively than distant blockers, producing
   soft contact shadows without tracing many light rays. */
float photo_soft_shadow(vec3 ray_origin, vec3 ray_direction, float min_distance, float max_distance) {
    float shadow = 1.0;
    float travel = min_distance;
    int step_index = 0;

    for (step_index = 0; step_index < PHOTO_SHADOW_STEPS; step_index += 1) {
        float distance_to_scene = scene_occluder_sdf(ray_origin + ray_direction * travel);
        float ratio = clamp(8.0 * distance_to_scene / max(travel, 0.001), 0.0, 1.0);

        shadow = min(shadow, ratio);
        travel += clamp(distance_to_scene * RAY_STEP_SCALE, 0.35, 5.5);

        if (shadow < 0.004 || travel > max_distance) {
            break;
        }
    }

    shadow = clamp(shadow, 0.0, 1.0);
    return shadow * shadow * (3.0 - 2.0 * shadow);
}
#endif

/* Photo AO compares expected free distance along the normal with the actual
   occluder field. The range is short in model units so it reads as contact and
   crease shadow rather than broad environment lighting. */
float photo_ambient_occlusion(vec3 point, vec3 normal) {
    float occlusion = 0.0;
    float scale = 1.0;
    int step_index = 0;

    for (step_index = 0; step_index < PHOTO_AO_STEPS; step_index += 1) {
        float sample_distance = mix(
            PHOTO_AO_START_DISTANCE,
            PHOTO_AO_END_DISTANCE,
            float(step_index) / float(PHOTO_AO_STEPS - 1)
        );
        float distance_to_scene = scene_occluder_sdf(point + normal * sample_distance);

        occlusion += (sample_distance - distance_to_scene) * scale / PHOTO_AO_REFERENCE_UNIT_MM;
        scale *= 0.95;

        if (occlusion > 0.35) {
            break;
        }
    }

    return clamp(1.0 - 3.0 * occlusion, 0.0, 1.0);
}

#if SDFMAKE_PHOTO_MODE
/* The checker is analytically filtered with projected ray differentials. This
   keeps the ground pattern from crawling at shallow angles where many cells
   collapse into one pixel. */
float photo_checkered_grid(vec2 point, vec2 dpdx, vec2 dpdy) {
    vec2 width = abs(dpdx) + abs(dpdy) + vec2(0.001);
    vec2 integral = 2.0 * (
        abs(fract((point - 0.5 * width) * 0.5) - 0.5)
        - abs(fract((point + 0.5 * width) * 0.5) - 0.5)
    ) / width;

    return 0.5 - 0.5 * integral.x * integral.y;
}

/* Ground material is derived from the ray footprint on z=0, not from color
   derivatives. That keeps checker filtering stable when object silhouettes
   interrupt the local pixel neighborhood. */
vec3 photo_ground_material(vec3 point, vec3 ray_direction, vec3 rdx, vec3 rdy) {
    vec3 dpdx = vec3(0.0);
    vec3 dpdy = vec3(0.0);
    float check = 0.0;
    float fine_grid = 0.0;
    float major_grid = 0.0;
    vec3 base_color = vec3(0.46);

    if (abs(ray_direction.z) > 0.0001 && abs(rdx.z) > 0.0001 && abs(rdy.z) > 0.0001) {
        dpdx = u_camera_position.z * (ray_direction / ray_direction.z - rdx / rdx.z);
        dpdy = u_camera_position.z * (ray_direction / ray_direction.z - rdy / rdy.z);
    }

    check = photo_checkered_grid(point.xy / 10.0, dpdx.xy / 10.0, dpdy.xy / 10.0);
    fine_grid = grid_line(point.xy, GRID_CELL_SIZE) * 0.18;
    major_grid = grid_line(point.xy, GRID_CELL_SIZE * 5.0) * 0.34;
    base_color = mix(vec3(0.42), vec3(0.54), check);
    base_color = mix(base_color, vec3(0.18), max(fine_grid, major_grid));

    return base_color * 0.25;
}
#endif

/* The base color includes a small view-facing response before lighting. This
   gives rounded blends more body and is mirrored in the mesh shader. */
vec3 photo_object_material(vec3 base_color, vec3 normal, vec3 ray_direction) {
    float facing = clamp(dot(normal, -ray_direction), 0.0, 1.0);

    return clamp(base_color, vec3(0.0), vec3(1.0)) * mix(0.82, 1.08, facing);
}

#if SDFMAKE_PHOTO_MODE
/* The photo lighting is a compact physical approximation: one warm key light,
   sky-dependent diffuse fill, a weak back fill, and Fresnel-weighted specular.
   Reflection color samples only the procedural sky, not other scene geometry. */
vec3 photo_lighting(vec3 point, vec3 normal, vec3 ray_direction, vec3 material, float reflectivity) {
    vec3 sun_direction = normalize(vec3(0.769615, -0.133013, 0.4));
    vec3 back_direction = normalize(vec3(0.55, 0.20, 0.35));
    vec3 reflected = reflect(ray_direction, normal);
    vec3 half_vector = normalize(sun_direction - ray_direction);
    float occlusion = photo_ambient_occlusion(point, normal);
    float sun_shadow = photo_soft_shadow(point + normal * 0.22, sun_direction, 0.6, 260.0);
    float sky_shadow = photo_soft_shadow(point + normal * 0.22, reflected, 0.6, 160.0);
    float sun_diffuse = max(dot(normal, sun_direction), 0.0) * sun_shadow;
    float sky_diffuse = sqrt(clamp(0.5 + 0.5 * normal.z, 0.0, 1.0)) * occlusion;
    float back_diffuse = max(dot(normal, back_direction), 0.0) * occlusion;
    float fresnel = pow(clamp(1.0 + dot(normal, ray_direction), 0.0, 1.0), 5.0);
    float sun_fresnel = 0.04 + 0.96 * pow(clamp(1.0 - dot(half_vector, sun_direction), 0.0, 1.0), 5.0);
    float sun_specular = pow(max(dot(normal, half_vector), 0.0), 16.0) * sun_diffuse * sun_fresnel;
    float sky_specular = smoothstep(-0.2, 0.2, reflected.z) * sky_diffuse * (0.04 + 0.96 * fresnel) * sky_shadow;
    vec3 sky_diffuse_color = sky_background(normal);
    vec3 sky_specular_color = sky_background(reflected);
    vec3 color = material * 0.18 * occlusion;

    color += material * sun_diffuse * vec3(1.34, 1.08, 0.78) * 1.38;
    color += material * sky_diffuse * sky_diffuse_color * 0.56;
    color += material * back_diffuse * vec3(0.40) * 0.42;
    color += vec3(1.30, 1.00, 0.70) * sun_specular * reflectivity * 5.00;
    color += sky_specular_color * sky_specular * reflectivity * 2.00;
    color += material * pow(clamp(1.0 + dot(normal, ray_direction), 0.0, 1.0), 2.0) * occlusion * 0.16;

    return color;
}

/* A photo sample resolves the nearest visible surface between the SDF model and
   the ground plane. Both use the same lighting function so contact AO and sky
   response agree at the object-ground boundary. */
vec3 photo_render_sample(vec2 frag_coord) {
    vec3 ray_direction = photo_ray_direction(frag_coord);
    vec3 rdx = photo_ray_direction(frag_coord + vec2(1.0, 0.0));
    vec3 rdy = photo_ray_direction(frag_coord + vec2(0.0, 1.0));
    float object_hit = trace_scene(u_camera_position, ray_direction);
    float plane_hit = plane_hit_distance(u_camera_position, ray_direction);
    float hit = object_hit;
    float material_id = 2.0;
    vec3 color = sky_background(ray_direction);
    vec3 point = vec3(0.0);
    vec3 normal = vec3(0.0, 0.0, 1.0);
    vec3 material = vec3(0.0);
    float fog = 0.0;
    float fog_height = 1.0;

    if (plane_hit > 0.0 && u_camera_position.z >= 0.0 && (hit < 0.0 || plane_hit < hit)) {
        hit = plane_hit;
        material_id = 1.0;
    }

    if (hit > 0.0) {
        point = u_camera_position + ray_direction * hit;

        if (material_id < 1.5) {
            normal = vec3(0.0, 0.0, 1.0);
            material = photo_ground_material(point, ray_direction, rdx, rdy);
            color = photo_lighting(point, normal, ray_direction, material, 0.8);
        } else {
            SdfSample object_sample = scene_sample(point);
            normal = estimate_normal(point);
            material = photo_object_material(object_sample.color, normal, ray_direction);
            color = photo_lighting(point, normal, ray_direction, material, 1.0);
        }

        fog_height = mix(1.0, 0.0, smoothstep(0.0, max(u_bounds_size, 1.0), point.z));
        fog = (1.0 - exp(-PHOTO_FOG_DENSITY * hit * hit * hit)) * fog_height;
        color = mix(color, sky_background(ray_direction), clamp(fog, 0.0, PHOTO_FOG_MAX));
    }

    return color;
}

/* The AA loop remains structured even when the sample count is one. It keeps
   quality tuning local to the shader constants instead of the JavaScript pass
   selection code. */
vec3 photo_render_color() {
    vec3 color = vec3(0.0);
    int x_index = 0;
    int y_index = 0;

    for (y_index = 0; y_index < PHOTO_AA; y_index += 1) {
        for (x_index = 0; x_index < PHOTO_AA; x_index += 1) {
            vec2 offset = (vec2(float(x_index), float(y_index)) + vec2(0.5)) / float(PHOTO_AA) - vec2(0.5);
            color += photo_render_sample(gl_FragCoord.xy + offset);
        }
    }

    color /= float(PHOTO_AA * PHOTO_AA);

    return display_color(color);
}
#endif

/* Grid lines use fragment derivatives so their apparent width remains stable
   under perspective. Mesh and SDF ground planes share this scale. */
float grid_line(vec2 point, float cell_size) {
    vec2 coord = point / cell_size;
    vec2 width = max(fwidth(coord), vec2(0.0001));
    vec2 grid = abs(fract(coord - 0.5) - 0.5) / width;
    return 1.0 - min(min(grid.x, grid.y), 1.0);
}

/* The bounds fill is a subtle top-down cue for the triangulation volume. It is
   applied on the ground plane so it does not compete with the wire box. */
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

float plane_hit_distance(vec3 ray_origin, vec3 ray_direction) {
    if (abs(ray_direction.z) <= 0.0001) {
        return -1.0;
    }

    return -ray_origin.z / ray_direction.z;
}

/* Ground, grid, and bounds overlays are premultiplied before composition. This
   avoids the dark fringe artifacts that appear when translucent lines are mixed
   over the sky and ground with straight-alpha colors. */
vec3 over_premul(vec3 color, vec3 premul_color, float alpha) {
    return premul_color + color * (1.0 - alpha);
}

float safe_inverse(float value) {
    if (abs(value) < 0.0001) {
        if (value < 0.0) {
            return -10000.0;
        }

        return 10000.0;
    }

    return 1.0 / value;
}

/* The slab test is shared by trace limiting and the bounds wire. The guarded
   inverse keeps near-axis-aligned camera rays from producing NaNs. */
vec2 box_hit_range(vec3 ray_origin, vec3 ray_direction, vec3 box_min, vec3 box_max) {
    vec3 inv_direction = vec3(
        safe_inverse(ray_direction.x),
        safe_inverse(ray_direction.y),
        safe_inverse(ray_direction.z)
    );
    vec3 t0 = (box_min - ray_origin) * inv_direction;
    vec3 t1 = (box_max - ray_origin) * inv_direction;
    vec3 t_near = min(t0, t1);
    vec3 t_far = max(t0, t1);
    return vec2(
        max(max(t_near.x, t_near.y), t_near.z),
        min(min(t_far.x, t_far.y), t_far.z)
    );
}

/* Wire thickness grows slightly with hit distance so the bounds remain visible
   at zoomed-out views without turning the volume into a heavy black box. */
float bounds_edge_mask(vec3 point, vec3 box_min, vec3 box_max, float hit_distance) {
    vec3 edge_distance = min(abs(point - box_min), abs(point - box_max));
    float width = max(hit_distance * 0.0012, 0.08);
    float x_edge = 1.0 - smoothstep(width, width * 2.5, edge_distance.x);
    float y_edge = 1.0 - smoothstep(width, width * 2.5, edge_distance.y);
    float z_edge = 1.0 - smoothstep(width, width * 2.5, edge_distance.z);
    float xy_edge = min(x_edge, y_edge);
    float xz_edge = min(x_edge, z_edge);
    float yz_edge = min(y_edge, z_edge);
    return max(max(xy_edge, xz_edge), yz_edge);
}

/* The bounds wire is analytical because the SDF pass has no depth buffer. Front
   and back intersections use different opacity so the volume reads as a guide
   rather than solid geometry. */
vec3 bounds_wire_color(vec3 color, vec3 ray_origin, vec3 ray_direction, float object_hit) {
    float volume_size = max(u_bounds_size, 0.0);
    float half_size = volume_size * 0.5;
    vec3 box_min = vec3(-half_size, -half_size, 0.0);
    vec3 box_max = vec3(half_size, half_size, volume_size);
    vec2 hit_range = box_hit_range(ray_origin, ray_direction, box_min, box_max);
    float alpha = 0.0;
    vec3 point = vec3(0.0);

    if (u_show_bounds_wire <= 0.0 || volume_size <= 0.0 || hit_range.x > hit_range.y || hit_range.y <= 0.0) {
        return color;
    }

    if (hit_range.x > 0.0 && (object_hit < 0.0 || hit_range.x <= object_hit + SURFACE_DISTANCE * 4.0)) {
        point = ray_origin + ray_direction * hit_range.x;
        alpha = max(alpha, bounds_edge_mask(point, box_min, box_max, hit_range.x) * 0.26);
    }

    if (hit_range.y > 0.0 && (object_hit < 0.0 || hit_range.y <= object_hit + SURFACE_DISTANCE * 4.0)) {
        point = ray_origin + ray_direction * hit_range.y;
        alpha = max(alpha, bounds_edge_mask(point, box_min, box_max, hit_range.y) * 0.18);
    }

    return over_premul(color, vec3(0.0), alpha);
}

/* The solid preview ground is a composited overlay, not a traced object. It is
   opaque from above, transparent from below, and still participates in AO through
   scene_occluder_sdf. */
vec3 grid_plane_color(vec3 color, vec3 plane_point, float top_view) {
    float grid_distance = length(plane_point.xy);
    float grid_fade = 1.0 - smoothstep(1000.0, 1600.0, grid_distance);
    float minor_grid = grid_line(plane_point.xy, GRID_CELL_SIZE);
    float major_grid = grid_line(plane_point.xy, GRID_CELL_SIZE * 5.0);
    float fill_alpha = top_view * grid_fade;
    float ground_ao = 1.0;
    float minor_alpha = minor_grid * grid_fade * 0.20;
    float major_alpha = major_grid * grid_fade * 0.43;
    float bounds_alpha = bounds_area_mask(plane_point.xy) * fill_alpha * 0.08;

    if (fill_alpha > 0.001) {
        ground_ao = photo_ambient_occlusion(plane_point, vec3(0.0, 0.0, 1.0));
    }

    color = over_premul(color, vec3(0.25 * ground_ao) * fill_alpha, fill_alpha);
    color = over_premul(color, vec3(0.0), bounds_alpha);
    color = over_premul(color, vec3(0.0), minor_alpha);
    color = over_premul(color, vec3(0.0), major_alpha);

    return color;
}

/* The interactive solid mode shares the photo material response but omits soft
   shadows and reflection sampling. This keeps it visually close to photo mode
   while avoiding extra SDF traces per pixel. */
vec3 object_color(vec3 point, vec3 normal, vec3 ray_direction) {
    vec3 sun_direction = normalize(vec3(0.769615, -0.133013, 0.4));
    vec3 back_direction = normalize(vec3(0.55, 0.20, 0.35));
    vec3 half_vector = normalize(sun_direction - ray_direction);
    SdfSample object_sample = scene_sample(point);
    vec3 material = photo_object_material(object_sample.color, normal, ray_direction);
    float occlusion = photo_ambient_occlusion(point, normal);
    float sun_diffuse = max(dot(normal, sun_direction), 0.0);
    float sky_diffuse = sqrt(clamp(0.5 + 0.5 * normal.z, 0.0, 1.0)) * occlusion;
    float back_diffuse = max(dot(normal, back_direction), 0.0) * occlusion;
    float sun_fresnel = 0.04 + 0.96 * pow(clamp(1.0 - dot(half_vector, sun_direction), 0.0, 1.0), 5.0);
    float sun_specular = pow(max(dot(normal, half_vector), 0.0), 16.0) * sun_diffuse * sun_fresnel;
    vec3 sky_diffuse_color = sky_background(normal);
    vec3 color = material * 0.18 * occlusion;
    float view_fill = clamp(1.0 + dot(normal, ray_direction), 0.0, 1.0);

    color += material * sun_diffuse * vec3(1.34, 1.08, 0.78) * 1.38;
    color += material * sky_diffuse * sky_diffuse_color * 0.56;
    color += material * back_diffuse * vec3(0.40) * 0.42;
    color += vec3(1.30, 1.00, 0.70) * sun_specular * 1.0;
    color += material * view_fill * view_fill * occlusion * 0.16;

    return color;
}

void main() {
#if SDFMAKE_PHOTO_MODE
    o_color = vec4(photo_render_color(), 1.0);
#else
    /* The default path keeps object tracing, ground overlay, and bounds wire
       separate for responsiveness. */
    vec2 pixel = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
    vec3 forward = normalize(u_camera_target - u_camera_position);
    vec3 ray_direction = normalize(forward + pixel.x * u_camera_right + pixel.y * u_camera_up);
    float hit = trace_scene(u_camera_position, ray_direction);
    float plane_hit = plane_hit_distance(u_camera_position, ray_direction);
    vec3 color = sky_background(ray_direction);

    if (plane_hit > 0.0) {
        vec3 plane_point = u_camera_position + ray_direction * plane_hit;
        float top_view = step(0.0, u_camera_position.z);
        color = grid_plane_color(color, plane_point, top_view);
    }

    if (hit > 0.0) {
        vec3 p = u_camera_position + ray_direction * hit;
        vec3 normal = estimate_normal(p);
        color = object_color(p, normal, ray_direction);
    }

    color = bounds_wire_color(color, u_camera_position, ray_direction, hit);

    o_color = vec4(display_color(color), 1.0);
#endif
}
