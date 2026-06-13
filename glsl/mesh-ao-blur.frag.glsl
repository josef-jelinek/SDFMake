#version 300 es

precision highp float;

out vec4 out_color;

uniform vec2 u_resolution;
uniform sampler2D u_ao_texture;
uniform sampler2D u_depth_texture;
uniform sampler2D u_normal_texture;

#define AO_BLUR_RADIUS 3
#define AO_BLUR_SPATIAL_FALLOFF 0.36
#define AO_BLUR_DEPTH_FALLOFF 1600.0
#define AO_BLUR_NORMAL_FALLOFF 8.0

/* Depth 1.0 is the cleared background. Treating it as invalid keeps the blur
   from pulling shadow alpha out into the sky. */
float valid_depth(float depth) {
    if (depth >= 0.999999) {
        return 0.0;
    }

    return 1.0;
}

/* Normal agreement turns the depth blur into a fuller bilateral filter. It
   smooths screen-space AO noise across one surface while preserving dark lines
   at real creases, where neighboring G-buffer normals diverge sharply. */
vec3 decode_normal(vec4 encoded_normal) {
    return normalize(encoded_normal.rgb * 2.0 - 1.0);
}

void main() {
    vec2 pixel = gl_FragCoord.xy;
    vec2 uv = pixel / u_resolution;
    float center_depth = texture(u_depth_texture, uv).r;
    vec4 center_encoded_normal = texture(u_normal_texture, uv);
    vec3 center_normal = vec3(0.0, 0.0, 1.0);
    float total = 0.0;
    float weight_total = 0.0;
    int x = 0;
    int y = 0;

    if (valid_depth(center_depth) < 0.5 || center_encoded_normal.a <= 0.01) {
        out_color = vec4(0.0);
        return;
    }

    center_normal = decode_normal(center_encoded_normal);

    /* This is a small bilateral blur: nearby pixels blend strongly, but depth
       jumps and normal changes stop AO from bleeding across silhouettes and
       sharp mesh edges. */
    for (y = -AO_BLUR_RADIUS; y <= AO_BLUR_RADIUS; y += 1) {
        for (x = -AO_BLUR_RADIUS; x <= AO_BLUR_RADIUS; x += 1) {
            vec2 offset = vec2(float(x), float(y));
            vec2 sample_uv = (pixel + offset) / u_resolution;
            float sample_depth = texture(u_depth_texture, sample_uv).r;
            vec4 sample_encoded_normal = texture(u_normal_texture, sample_uv);

            if (sample_uv.x >= 0.0 && sample_uv.x <= 1.0 && sample_uv.y >= 0.0 && sample_uv.y <= 1.0 && valid_depth(sample_depth) > 0.5 && sample_encoded_normal.a > 0.01) {
                float sample_ao = texture(u_ao_texture, sample_uv).a;
                vec3 sample_normal = decode_normal(sample_encoded_normal);
                float spatial_weight = exp(-dot(offset, offset) * AO_BLUR_SPATIAL_FALLOFF);
                float depth_weight = exp(-abs(sample_depth - center_depth) * AO_BLUR_DEPTH_FALLOFF);
                float normal_weight = pow(max(dot(center_normal, sample_normal), 0.0), AO_BLUR_NORMAL_FALLOFF);
                float weight = spatial_weight * depth_weight * normal_weight * sample_encoded_normal.a;

                total += sample_ao * weight;
                weight_total += weight;
            }
        }
    }

    if (weight_total <= 0.0) {
        out_color = texture(u_ao_texture, uv);
        return;
    }

    out_color = vec4(0.0, 0.0, 0.0, total / weight_total);
}
