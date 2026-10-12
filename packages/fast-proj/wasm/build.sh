#!/usr/bin/env bash
# Build the wasm kernels.
#   build.sh            -> ../dist/fast-proj.wasm (simd128), bounded 4 MiB heap
#   build.sh --bench    -> build/simd.wasm and build/scalar.wasm with the 256 MiB heap for the raw-export benches
#                          and checks (the scalar kernel is the reference for the vector one; it isn't shipped)
set -euo pipefail
cd "$(dirname "$0")"
target=target/wasm32-unknown-unknown/release/fast_proj_wasm.wasm
if [[ "${1:-}" == "--bench" ]]; then
  mkdir -p build
  RUSTFLAGS="-C target-feature=+simd128" cargo build --release --locked --target wasm32-unknown-unknown --features large-heap
  cp "$target" build/simd.wasm
  cargo build --release --locked --target wasm32-unknown-unknown --features large-heap
  cp "$target" build/scalar.wasm
  ls -l build/
else
  mkdir -p ../dist
  RUSTFLAGS="-C target-feature=+simd128" cargo build --release --locked --target wasm32-unknown-unknown
  cp "$target" ../dist/fast-proj.wasm
  ls -l ../dist/*.wasm
fi
