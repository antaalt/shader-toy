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

// EDITABLE-SECTION-START

// EDITABLE-SECTION-END

@fragment
fn fs_main(@builtin(position) frag : vec4f) -> @location(0) vec4f {
  // EDITABLE-SECTION-START
  return vec4f(cos(u.time), u.mouse.x * 0.001, 1.0, 1.0);
  // EDITABLE-SECTION-END
}
`
