export type TextAlign = "left" | "center" | "right";
export type TextVAlign = "top" | "center" | "bottom";
export type CropFormat = "original" | "square" | "portrait" | "landscape" | "wide";
export type ColorSortDirection = "horizontal" | "vertical";
export type SectionDirection = "vertical" | "horizontal";
export type DetailNoiseMode = "bw" | "color";

export type TextLayer = {
  text: string;
  align: TextAlign;
  vAlign: TextVAlign;
  x: number;
  y: number;
  size: number;
  font: string;
  opacity: number;
};

export type Pt = { x: number; y: number };

export type AreaShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rotation: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation: number }
  | { kind: 'path'; closed: boolean; side: 'a' | 'b'; tension: number; points: Pt[] };

export type EdgeMode = 'blend' | 'ragged';

export type SortArea = {
  id: string;
  label: string;
  color: string;
  visible: boolean;
  shape: AreaShape;
  edge: { feather: number; jitter: number; mode: EdgeMode };
  sort: {
    direction: ColorSortDirection;
    reverse: boolean;
    amount: number;
  };
  opacity: number;
};

export interface Generation {
  seed: number;
  image: string;
  draw: string;
  grayLevels: number;
  texts: TextLayer[];
  cropFormat: CropFormat;
  cropX: number;
  cropY: number;
  cropSize: number;
  cropPreview: boolean;
  colorSortAmount: number;
  colorSortDirection: ColorSortDirection;
  areas: SortArea[];
  areasMode: 'layers' | 'union';
  soloAreaId: string;
  sectionCount: number;
  sectionOffset: number;
  sectionDirection: SectionDirection;
  sectionInvertRatio: number;
  sectionPosterizeRatio: number;
  detailNoiseMode: DetailNoiseMode;
}

export const DEFAULT_GENERATION: Generation = {
  seed: 1,
  image: "/assets/door.jpg",
  draw: "grey-squares",
  grayLevels: 8,
  texts: [
    {
      text: "ATTENZIONE\nAL\nLEOPARDO",
      align: "right",
      vAlign: "center",
      x: 95,
      y: 50,
      size: 375,
      font: "/fonts/SpaceMono-Regular.ttf",
      opacity: 100,
    },
    {
      text: "",
      align: "left",
      vAlign: "bottom",
      x: 5,
      y: 95,
      size: 100,
      font: "/fonts/SpaceMono-Regular.ttf",
      opacity: 100,
    },
  ],
  cropFormat: "original",
  cropX: 50,
  cropY: 50,
  cropSize: 100,
  cropPreview: true,
  colorSortAmount: 100,
  colorSortDirection: "horizontal",
  areas: [],
  areasMode: 'layers',
  soloAreaId: '',
  sectionCount: 3,
  sectionOffset: 33,
  sectionDirection: "vertical",
  sectionInvertRatio: 5,
  sectionPosterizeRatio: 20,
  detailNoiseMode: "bw",
};
