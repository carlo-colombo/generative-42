// The app can be served from a subdirectory (GitHub Pages serves a project
// site at /<repo>/), so every URL is a deployment base plus a logical app path.
// Generation values (image references, font paths) stay logical — always
// root-relative like /assets/x.jpg — so a URL made under one base still renders
// under another.
const rawBase = import.meta.env.BASE_URL ?? '/'

export const BASE = rawBase === '/' || rawBase.endsWith('/') ? rawBase : `${rawBase}/`

export function appUrl(path: string): string {
  if (!path.startsWith('/')) return path
  return `${BASE}${path.slice(1)}`
}

export function logicalPath(pathname: string): string {
  if (BASE === '/' || !pathname.startsWith(BASE)) return pathname
  return `/${pathname.slice(BASE.length)}`
}
