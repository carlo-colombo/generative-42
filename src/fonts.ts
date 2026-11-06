export interface FontOption {
  label: string;
  path: string;
}

export const FONTS: FontOption[] = [
  { label: "Space Mono", path: "/fonts/SpaceMono-Regular.ttf" },
  { label: "Bebas Neue", path: "/fonts/BebasNeue-Regular.ttf" },
  { label: "Bungee", path: "/fonts/Bungee-Regular.ttf" },
  { label: "Monoton", path: "/fonts/Monoton-Regular.ttf" },
  { label: "Jost", path: "/fonts/Jost-Variable.ttf" },
  { label: "Monaspace Krypton", path: "/fonts/MonaspaceKrypton-Regular.ttf" },
];

export const DEFAULT_FONT = FONTS[0].path;

export type LoadedFont = {
  path: string
  family: string
  face: FontFace
}

export function fontFamily(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return base.replace(/[^A-Za-z0-9_-]/g, '-')
}

export function fontCss(font: LoadedFont, size: number): string {
  return `${size}px "${font.family}"`
}

export async function loadFonts(paths: string[]): Promise<Map<string, LoadedFont>> {
  const loaded = new Map<string, LoadedFont>()
  for (const path of new Set(paths)) {
    const family = fontFamily(path)
    const face = new FontFace(family, `url("${path}")`)
    try {
      await face.load()
    } catch (error) {
      console.warn(`Font failed to load, skipping: ${path}`, error)
      continue
    }
    document.fonts.add(face)
    loaded.set(path, { path, family, face })
  }
  return loaded
}
