# Optional Wasm resource lifecycle (design direction)

This is a follow-up API direction, not an implementation in the arithmetic PR.

Keep the default TypeScript export. An optional Wasm initializer compiles the
module once (or accepts an already compiled `WebAssembly.Module`) and creates
an independently owned context. Cache the compiled module, not a live instance.
A failed load/compile must be retryable; report whether SIMD or the requested
TypeScript fallback was selected, and surface corrupt artifacts as errors.

Each context owns its instance and modest, reusable workspace. Converters share
that workspace and retain only projection parameters initially. Batch calls stay
synchronous, allocate no scratch in the hot loop, and return caller-owned arrays.
A single 64 Ki-point workspace needs roughly 2 MiB, independent of the number of
converters. Allocate lazily or allow a configurable capacity for small workloads.
Replace the 256 MiB static arena with bounded workspace memory; general-purpose
malloc/free is unnecessary if the context owns all scratch. Subsequent coefficient
caching can use reclaimable fixed-size slots per converter.

Expose idempotent `dispose()` and `[Symbol.dispose]()` on owners. `using` provides
scope-based cleanup; simply letting a variable become unreachable does not call
`dispose()`. Disposing a converter invalidates it and releases its references or
coefficient slot. Disposing a context invalidates its converters and clears the
instance, exports and view references through shared owner state. Disposed objects
must not retain independent closures over those resources. Calls after disposal
throw consistently. Never implement per-converter disposal with `heap_reset()`:
it would invalidate other live buffers.

Workspace ownership must include input/output copying. Arbitrary ArrayLike getters
or setters can reenter conversion: hold a lease with `try/finally`, and either reject
nested use or explicitly provide another workspace. Disposal during an active call
must throw without changing ownership state. Keep ordinary output arrays usable
after disposal; a later direct-memory API needs separately documented leases.

Returning blocks to an allocator/pool makes them reusable but does not shrink Wasm
linear memory. Disposing the context releases ownership and makes its memory
eligible for garbage collection; it does not guarantee immediate physical memory
reclamation. If memory grows on demand, refresh internal typed-array views because
ordinary Wasm memory growth detaches the previous buffer.

References: [TypeScript resource management](https://www.typescriptlang.org/docs/handbook/variable-declarations#using-declarations),
[Wasm memory growth](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow).
