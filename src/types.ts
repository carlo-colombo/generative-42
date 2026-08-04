export interface Generation {
  seed: number;
  image: string;
  draw: string;
  text: string;
}

export const DEFAULT_GENERATION: Generation = {
  seed: 1,
  image: "/assets/door.jpg",
  draw: "random-rect",
  text: "ATTENZIONE\nAL\nLEOPARDO",
};
