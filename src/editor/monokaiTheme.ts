import * as monaco from 'monaco-editor'
// `monaco-themes` only exports its tmTheme parser, not `themes/*.json`, so the
// file is imported by path. Vite inlines it at build time.
import monokai from '../../node_modules/monaco-themes/themes/Monokai.json'

export const MONOKAI_THEME_ID = 'monokai'

// Monokai.json is a converted TextMate theme, so its rules use TextMate scopes
// (`constant.numeric`, `support.type`, ...). Monaco's `wgsl` tokenizer emits its
// own short token names instead, and the ones below have no TextMate equivalent
// in that file — without these they would fall back to the plain editor
// foreground. Colours are Monokai's own palette.
const WGSL_TOKEN_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: 'number', foreground: 'ae81ff' }, // covers number.float / number.hex
  { token: 'variable.predefined', foreground: '66d9ef', fontStyle: 'italic' },
  { token: 'annotation', foreground: 'a6e22e' }, // @vertex, @group(0), ...
  { token: 'operator', foreground: 'f92672' },
  { token: 'delimiter', foreground: 'f8f8f2' },
  { token: 'meta.content', foreground: 'e6db74' }, // `enable ...;` directives
]

/**
 * Registers Monokai under {@link MONOKAI_THEME_ID}. Must run before
 * `monaco.editor.create` (or be followed by `monaco.editor.setTheme`).
 */
export function defineMonokaiTheme() {
  monaco.editor.defineTheme(MONOKAI_THEME_ID, {
    ...monokai,
    base: monokai.base as monaco.editor.BuiltinTheme,
    // Later rules win, so the WGSL mappings sit at the end.
    rules: [...monokai.rules, ...WGSL_TOKEN_RULES],
  })
}
