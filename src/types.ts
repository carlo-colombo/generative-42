export type TextAlign = "left" | "center" | "right";
export type TextVAlign = "top" | "center" | "bottom";

export interface Generation {
  seed: number;
  image: string;
  draw: string;
  text: string;
  textAlign: TextAlign;
  textVAlign: TextVAlign;
  textSize: number;
  font: string;
  textOpacity: number;
}

export const DEFAULT_GENERATION: Generation = {
  seed: 1,
  image: "/assets/door.jpg",
  draw: "random-rect",
  text: "ATTENZIONE\nAL\nLEOPARDO",
  textAlign: "right",
  textVAlign: "center",
  textSize: 375,
  font: "/fonts/SpaceMono-Regular.ttf",
  textOpacity: 100,
};
