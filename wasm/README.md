# WebAssembly kernels

The browser loads the generated `public/wasm/kernels.wasm`, which is ignored by Git. `pnpm dev`, `pnpm build`, and `pnpm test:wasm` rebuild it with Zig 0.17.x before using it. Install Zig before running those commands locally.

```sh
pnpm build:wasm
pnpm test:wasm
```

`build.zig` at the repository root compiles `wasm/src/kernels.zig` for
`wasm32-freestanding` and installs it to `public/wasm/kernels.wasm`, so a plain
`zig build` from anywhere in the repository does the same thing. Pass
`-Doptimize=debug` (or `safe`, `small`) to change the release mode; the default
is `fast`.

`wasm/src/kernels.zig` currently provides:

- `maskWeight`: rect/ellipse distance masks and path scanline fill with edge-distance work restricted to a feather/jitter band.
- `curtainGrid`: cell averaging, band generation, fill, and inverse/posterize/grayscale in one pass. It writes one RGBA output buffer rather than building and filtering a second canvas.
- `sampleQuads`: one batched call for all of an effect's sample quadrilaterals, reading a single downscaled source image.
- `pixelFilter`: in-place inverse, posterize, and grayscale filters, also used for the `sections` effect.
- `pixelSort`, `poissonSites`, `voronoiCells`, `detailNoise`, and chunked `compositeLayer`.

Buffers are passed as pointers into exported WASM memory. `palloc` allocates until `pfree`; kernels use temporary storage from the same linear heap and reset its scratch mark before each call. Keep calls synchronous and do not retain a WASM memory view across a call that might grow memory.

The kernels use deterministic seeded `mulberry32` for curtain placement, pixel sorting, and detail noise. Changes in random sequence or integer rounding relative to p5 are acceptable; the same seed remains deterministic within this implementation.

For Chrome Performance user-timing entries around each WASM call, open the app with `?seed=1&wasmProfile=1` and record a render. Measures use names such as `WASM sampleQuads`, `WASM pixelSort`, `WASM detailNoise`, and `WASM compositeLayer`. Profiling is off by default; the helper clears old marks/measures after 1,000 measured calls to bound memory use.
