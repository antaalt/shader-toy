/**
 * The starting document. It is a *complete* WGSL module rather than a bare
 * fragment body: the renderer hands the editor text to `createShaderModule`
 * untouched, so nothing is prepended and line numbers in both WebGPU
 * compilation messages and language-server diagnostics line up exactly with
 * what you see in the editor.
 *
 * The renderer only requires two things of this module:
 *   - a `@vertex fn vs_main` drawing 3 vertices, and
 *   - a `@fragment fn fs_main` returning `@location(0) vec4f`,
 * plus the `Uniforms` binding at `@group(0) @binding(0)`.
 */
export const DEFAULT_SHADER = `// Uniforms filled in by the host each frame.
struct Uniforms {
  resolution : vec2f,   // canvas size in physical pixels
  mouse      : vec2f,   // cursor position in physical pixels
  time       : f32,     // seconds since start
  frame      : f32,     // frames since start
}
@group(0) @binding(0) var<uniform> u : Uniforms;

// Fullscreen triangle: 3 vertices covering the clip-space viewport.
@vertex
fn vs_main(@builtin(vertex_index) index : u32) -> @builtin(position) vec4f {
  let corners = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

// Iñigo Quílez's cosine gradient palette.
fn palette(t : f32) -> vec3f {
  let amp = vec3f(0.95, 0.85, 0.75);
  let phase = vec3f(0.0, 0.25, 0.55);
  return 0.5 + 0.5 * cos(6.28318 * (amp * t + phase));
}

@fragment
fn fs_main(@builtin(position) frag : vec4f) -> @location(0) vec4f {
  // Aspect-correct coordinates, [-1, 1] across the short axis.
  let uv = (frag.xy * 2.0 - u.resolution) / u.resolution.y;
  let mouse = (u.mouse * 2.0 - u.resolution) / u.resolution.y;

  var p = uv * 1.4;
  var colour = vec3f(0.0);

  for (var i = 0u; i < 5u; i++) {
    // Kaleidoscopic fold. The clamp keeps the inversion from blowing up.
    p = abs(p + mouse * 0.25) / clamp(dot(p, p), 0.25, 4.0) - 0.9;

    let glow = 0.014 / (abs(length(p) - 0.55) + 0.03);
    let tint = palette(f32(i) * 0.18 + u.time * 0.08 + length(uv) * 0.35);
    colour += tint * glow;
  }

  // Vignette, then a touch of gamma.
  colour *= 1.0 - 0.35 * length(uv);
  return vec4f(pow(max(colour, vec3f(0.0)), vec3f(0.85)), 1.0);
}
`
