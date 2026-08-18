/**
 * WGSL vocabulary, used by the built-in completion fallback in
 * `src/lsp/fallbackProvider.ts`.
 *
 * Tokenizer, brackets and comments come from `setupTextMate.ts`, which drives a
 * TextMate grammar through shiki.
 */

/**
 * Deliberately not `wgsl`: monaco-editor's basic-languages bundle owns that id
 * and installs a Monarch tokenizer for it lazily, on first use of the language.
 * That lazy registration would race — and could silently replace — the TextMate
 * tokens provider, since whichever registers last wins.
 */
export const WGSL_LANGUAGE_ID = 'wgsl-textmate'

/** Reserved words and declaration/statement keywords. */
export const WGSL_KEYWORDS = [
  'alias', 'break', 'case', 'const', 'const_assert', 'continue', 'continuing',
  'default', 'diagnostic', 'discard', 'else', 'enable', 'false', 'fn', 'for',
  'if', 'let', 'loop', 'override', 'requires', 'return', 'struct', 'switch',
  'true', 'var', 'while',
  // address spaces and access modes, which only appear inside `var<...>`
  'function', 'private', 'workgroup', 'uniform', 'storage', 'handle',
  'read', 'write', 'read_write',
]

/** Predeclared types, including the common vector/matrix aliases. */
export const WGSL_TYPES = [
  'bool', 'f16', 'f32', 'i32', 'u32',
  'vec2', 'vec3', 'vec4',
  'vec2f', 'vec3f', 'vec4f', 'vec2i', 'vec3i', 'vec4i',
  'vec2u', 'vec3u', 'vec4u', 'vec2h', 'vec3h', 'vec4h',
  'mat2x2', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x3', 'mat3x4',
  'mat4x2', 'mat4x3', 'mat4x4',
  'mat2x2f', 'mat2x3f', 'mat2x4f', 'mat3x2f', 'mat3x3f', 'mat3x4f',
  'mat4x2f', 'mat4x3f', 'mat4x4f',
  'array', 'atomic', 'ptr', 'sampler', 'sampler_comparison',
  'texture_1d', 'texture_2d', 'texture_2d_array', 'texture_3d',
  'texture_cube', 'texture_cube_array', 'texture_multisampled_2d',
  'texture_storage_1d', 'texture_storage_2d', 'texture_storage_2d_array',
  'texture_storage_3d', 'texture_depth_2d', 'texture_depth_2d_array',
  'texture_depth_cube', 'texture_depth_cube_array',
  'texture_depth_multisampled_2d', 'texture_external',
]

/** Built-in functions. */
export const WGSL_BUILTINS = [
  'abs', 'acos', 'acosh', 'all', 'any', 'asin', 'asinh', 'atan', 'atan2',
  'atanh', 'bitcast', 'ceil', 'clamp', 'cos', 'cosh', 'countLeadingZeros',
  'countOneBits', 'countTrailingZeros', 'cross', 'degrees', 'determinant',
  'distance', 'dot', 'exp', 'exp2', 'extractBits', 'faceForward',
  'firstLeadingBit', 'firstTrailingBit', 'floor', 'fma', 'fract', 'frexp',
  'insertBits', 'inverseSqrt', 'ldexp', 'length', 'log', 'log2', 'max', 'min',
  'mix', 'modf', 'normalize', 'pow', 'quantizeToF16', 'radians', 'reflect',
  'refract', 'reverseBits', 'round', 'saturate', 'select', 'sign', 'sin',
  'sinh', 'smoothstep', 'sqrt', 'step', 'tan', 'tanh', 'transpose', 'trunc',
  'dpdx', 'dpdxCoarse', 'dpdxFine', 'dpdy', 'dpdyCoarse', 'dpdyFine',
  'fwidth', 'fwidthCoarse', 'fwidthFine',
  'textureDimensions', 'textureGather', 'textureGatherCompare', 'textureLoad',
  'textureNumLayers', 'textureNumLevels', 'textureNumSamples', 'textureSample',
  'textureSampleBias', 'textureSampleCompare', 'textureSampleCompareLevel',
  'textureSampleGrad', 'textureSampleLevel', 'textureSampleBaseClampToEdge',
  'textureStore',
  'atomicLoad', 'atomicStore', 'atomicAdd', 'atomicSub', 'atomicMax',
  'atomicMin', 'atomicAnd', 'atomicOr', 'atomicXor', 'atomicExchange',
  'atomicCompareExchangeWeak',
  'arrayLength', 'workgroupBarrier', 'storageBarrier', 'textureBarrier',
  'workgroupUniformLoad',
  'pack4x8snorm', 'pack4x8unorm', 'pack2x16snorm', 'pack2x16unorm',
  'pack2x16float', 'unpack4x8snorm', 'unpack4x8unorm', 'unpack2x16snorm',
  'unpack2x16unorm', 'unpack2x16float',
]

/** Attribute names, written `@name` in source. */
export const WGSL_ATTRIBUTES = [
  'align', 'binding', 'builtin', 'compute', 'const', 'diagnostic', 'fragment',
  'group', 'id', 'interpolate', 'invariant', 'location', 'must_use', 'size',
  'vertex', 'workgroup_size',
]
