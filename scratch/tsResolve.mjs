/**
 * Resolver hook so Node can load the extensionless relative imports that the
 * sources use (bundler-style, as Vite expects). Test-harness only.
 */
import { existsSync } from 'node:fs'

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL)
    if (existsSync(candidate)) {
      return { url: candidate.href, shortCircuit: true }
    }
  }
  return next(specifier, context)
}
