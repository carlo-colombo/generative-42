export type TextAlign = "left" | "center" | "right";
export type TextVAlign = "top" | "center" | "bottom";
export type CropFormat = "original" | "square" | "portrait" | "landscape" | "wide";
export type ColorSortDirection = "horizontal" | "vertical";
export type SectionDirection = "vertical" | "horizontal";
export type DetailNoiseMode = "bw" | "color";
export type CurtainEffect = "inverse" | "rasterize" | "greyscale";
export type CurtainAxis = "rows" | "columns";

export type Pt = { x: number; y: number };

export type AreaShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rotation: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation: number }
  | { kind: 'path'; closed: boolean; side: 'a' | 'b'; tension: number; points: Pt[] };

export type EdgeMode = 'blend' | 'ragged';

export type LayerEdge = { feather: number; jitter: number; mode: EdgeMode };

export type EffectId =
  | 'pixel-sort'
  | 'rotate'
  | 'rect'
  | 'circles'
  | 'grey-squares'
  | 'lines'
  | 'vertical-lines'
  | 'horizontal-lines'
  | 'galaxy'
  | 'voronoi'
  | 'sections'
  | 'detail-noise'
  | 'curtain-grid';

// Spans are measured in source pixels along the sort axis; past this width a
// typical run collapses into a handful of sortable units.
export const MAX_SPAN_WIDTH = 64;

export interface EffectParams {
  grayLevels: number;
  direction: ColorSortDirection;
  reverse: boolean;
  randomness: number;
  // Consecutive pixels along the sort axis averaged into one sortable span;
  // read by pixel-sort only.
  spanWidth: number;
  // Legacy ragged geometry: the per-line block is shortened and stays inside the
  // mask run instead of sliding along the whole line. Read by pixel-sort only.
  containedBlocks: boolean;
  // Read by pixel-sort and rotate. A legacy colorSortAmount can survive on any
  // migrated layer; switching the effect resets it to the selected effect's default.
  amount: number | null;
  sectionCount: number;
  sectionOffset: number;
  sectionDirection: SectionDirection;
  sectionInvertRatio: number;
  sectionPosterizeRatio: number;
  detailNoiseMode: DetailNoiseMode;
  // Target number of Poisson-disc sites; read by voronoi only.
  voronoiPoints: number;
  // Read by curtain-grid only.
  gridSize: number;
  gridMargin: number;
  // Curtain reach and edge irregularity, as shares of the canvas side.
  gridCurtainExtension: number;
  gridCurtainBalance: number;
  gridCurtainVariation: number;
  gridCurtainEffect: CurtainEffect;
  gridCurtainAxis: CurtainAxis;
}

export const DEFAULT_EFFECT_PARAMS: EffectParams = {
  grayLevels: 8,
  direction: "horizontal",
  reverse: false,
  randomness: 0,
  spanWidth: 1,
  containedBlocks: false,
  amount: null,
  sectionCount: 3,
  sectionOffset: 33,
  sectionDirection: "vertical",
  sectionInvertRatio: 5,
  sectionPosterizeRatio: 20,
  detailNoiseMode: "bw",
  voronoiPoints: 1200,
  gridSize: 90,
  gridMargin: 8,
  gridCurtainExtension: 35,
  gridCurtainBalance: 50,
  gridCurtainVariation: 35,
  gridCurtainEffect: "inverse",
  gridCurtainAxis: "rows",
};

export type LayerBase = {
  id: string;
  label: string;
  visible: boolean;
  opacity: number;
};

export type EffectLayer = LayerBase & {
  kind: 'effect';
  // Editor outline/chip tint only; the compositor never reads it.
  color: string;
  shape: AreaShape;
  edge: LayerEdge;
  effect: EffectId;
  params: EffectParams;
};

export type TextLayer = LayerBase & {
  kind: 'text';
  text: string;
  align: TextAlign;
  vAlign: TextVAlign;
  x: number;
  y: number;
  size: number;
  font: string;
};

export type Layer = EffectLayer | TextLayer;

export const LAYER_COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff9f1c'];

export interface Generation {
  seed: number;
  showSeed: boolean;
  image: string;
  cropFormat: CropFormat;
  cropX: number;
  cropY: number;
  cropSize: number;
  cropPreview: boolean;
  // The frame is a margin around the composition, sized by the ratio and growth
  // below; it never crops or rescales the image and effects never paint over it.
  frameOn: boolean;
  frameRatioW: number;
  frameRatioH: number;
  frameGrowth: number;
  frameColor: string;
  soloLayerId: string;
  // Bottom-to-top; the cropped source image is the implicit background.
  layers: Layer[];
}

export const FULL_CANVAS_SHAPE: AreaShape = { kind: 'rect', x: 0, y: 0, w: 1, h: 1, rotation: 0 };

// Every text layer field a stored or migrated layer may omit falls back to this
// placeholder, so no sample text is baked into a fresh generation.
export const DEFAULT_TEXT_LAYER: TextLayer = {
  kind: 'text',
  id: 't1',
  label: 'Text 1',
  visible: true,
  opacity: 100,
  text: '',
  align: 'left',
  vAlign: 'bottom',
  x: 5,
  y: 95,
  size: 100,
  font: '/fonts/SpaceMono-Regular.ttf',
};

// A fresh generation starts with the source image and an empty stack: no
// default effect and no sample text.
export const DEFAULT_GENERATION: Generation = {
  seed: 1,
  showSeed: true,
  image: "",
  cropFormat: "original",
  cropX: 50,
  cropY: 50,
  cropSize: 100,
  cropPreview: true,
  frameOn: false,
  frameRatioW: 4,
  frameRatioH: 3,
  frameGrowth: 0,
  frameColor: "#ffffff",
  soloLayerId: '',
  layers: [],
};
