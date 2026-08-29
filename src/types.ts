export type TextAlign = "left" | "center" | "right";
export type TextVAlign = "top" | "center" | "bottom";
export type CropFormat = "original" | "square" | "portrait" | "landscape" | "wide";
export type ColorSortDirection = "horizontal" | "vertical";

export interface Generation {
  seed: number;
  image: string;
  draw: string;
  grayLevels: number;
  text: string;
  textAlign: TextAlign;
  textVAlign: TextVAlign;
  textX: number;
  textY: number;
  textSize: number;
  font: string;
  textOpacity: number;
  text2: string;
  text2Align: TextAlign;
  text2VAlign: TextVAlign;
  text2X: number;
  text2Y: number;
  text2Size: number;
  text2Font: string;
  text2Opacity: number;
  cropFormat: CropFormat;
  cropX: number;
  cropY: number;
  cropSize: number;
  cropPreview: boolean;
  colorSortAmount: number;
  colorSortDirection: ColorSortDirection;
}

export const DEFAULT_GENERATION: Generation = {
  seed: 1,
  image: "/assets/door.jpg",
  draw: "grey-squares",
  grayLevels: 8,
  text: "ATTENZIONE\nAL\nLEOPARDO",
  textAlign: "right",
  textVAlign: "center",
  textX: 95,
  textY: 50,
  textSize: 375,
  font: "/fonts/SpaceMono-Regular.ttf",
  textOpacity: 100,
  text2: "",
  text2Align: "left",
  text2VAlign: "bottom",
  text2X: 5,
  text2Y: 95,
  text2Size: 100,
  text2Font: "/fonts/SpaceMono-Regular.ttf",
  text2Opacity: 100,
  cropFormat: "original",
  cropX: 50,
  cropY: 50,
  cropSize: 100,
  cropPreview: true,
  colorSortAmount: 100,
  colorSortDirection: "horizontal",
};
