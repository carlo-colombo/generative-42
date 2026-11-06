#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/wasm
zig build-exe wasm/src/kernels.zig \
  -target wasm32-freestanding \
  -O ReleaseFast \
  -fno-strip \
  -fno-entry \
  -rdynamic \
  -fno-stack-check \
  -femit-bin=public/wasm/kernels.wasm
chmod 644 public/wasm/kernels.wasm
