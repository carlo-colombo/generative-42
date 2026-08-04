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
