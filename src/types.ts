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
  sectionCount: 3,
  sectionOffset: 33,
  sectionDirection: "vertical",
  sectionInvertRatio: 5,
  sectionPosterizeRatio: 20,
  detailNoiseMode: "bw",
};
