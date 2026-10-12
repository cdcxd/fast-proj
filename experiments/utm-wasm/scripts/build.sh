#!/usr/bin/env bash
# Build both wasm variants into build/.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
RUSTFLAGS="-C target-feature=+simd128" cargo build --release --locked --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/utm_wasm.wasm build/simd.wasm
cargo build --release --locked --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/utm_wasm.wasm build/scalar.wasm
ls -l build/
