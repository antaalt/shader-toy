import * as monaco from 'monaco-editor'
import { shikiToMonaco } from '@shikijs/monaco'
import { createHighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import monokai from 'shiki/themes/monokai.mjs'
import type { LanguageRegistration } from 'shiki'
import wgslGrammar from './wgsl.tmLanguage.json'
import { WGSL_LANGUAGE_ID } from './wgslVocabulary'

/**
 * Theme id registered by `shikiToMonaco`. It comes from the TextMate theme's
 * own name, so swapping the theme import changes this value.
 */
export const THEME_ID = monokai.name ?? 'monokai'

// Only the grammar's `scopeName` and patterns come from the JSON file; `name`
// is what binds it to a Monaco language id, so it is set here to keep the
// grammar file drop-in replaceable.
const wgslLanguage = {
  ...(wgslGrammar as unknown as LanguageRegistration),
  name: WGSL_LANGUAGE_ID,
} satisfies LanguageRegistration

/**
 * Brackets, comments and auto-closing pairs. Monaco's basic-languages bundle
 * supplies these for its own `wgsl` id, but this project uses a private id (see
 * {@link WGSL_LANGUAGE_ID}) so nothing else registers them.
 */
const wgslConfiguration: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
  ],
}

/**
 * Registers the language id and its configuration. Synchronous, so it must run
 * before any model is created with this language.
 */
export function registerWgslLanguage(): void {
  monaco.languages.register({ id: WGSL_LANGUAGE_ID, extensions: ['.wgsl'], aliases: ['WGSL'] })
  monaco.languages.setLanguageConfiguration(WGSL_LANGUAGE_ID, wgslConfiguration)
}

/**
 * Tokenizes with the TextMate grammar instead of a Monarch tokenizer: shiki
 * runs the grammar through vscode-textmate + an Oniguruma WASM regex engine,
 * and `shikiToMonaco` installs the result as an encoded tokens provider plus a
 * matching Monaco theme.
 *
 * Awaits WASM and grammar setup, so the editor should be created after this
 * resolves — otherwise the first paint is unhighlighted.
 */
export async function installTextMateHighlighting(): Promise<void> {
  const highlighter = await createHighlighterCore({
    themes: [monokai],
    langs: [wgslLanguage],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  })

  shikiToMonaco(highlighter, monaco)
}
