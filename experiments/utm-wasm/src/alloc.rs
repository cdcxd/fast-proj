//! Bump allocator over exported wasm linear memory; JS holds zero-copy
//! `Float64Array` views. Allocate once per buffer and reuse — the arena
//! never frees; exhaustion traps loudly in release builds.

const HEAP_SIZE: usize = 1 << 28; // 256 MiB in bss; engines commit lazily
#[repr(align(8))]
struct AlignedHeap([u8; HEAP_SIZE]);
static mut HEAP: AlignedHeap = AlignedHeap([0; HEAP_SIZE]);
static mut OFFSET: usize = 0;

#[unsafe(no_mangle)]
pub extern "C" fn alloc(n_f64: usize) -> *mut f64 {
    unsafe {
        let o = OFFSET;
        let bytes = n_f64.checked_mul(8).unwrap_or(usize::MAX);
        if o.checked_add(bytes).map_or(true, |end| end > HEAP_SIZE) {
            panic!("wasm heap exhausted");
        }
        OFFSET = o + bytes;
        (core::ptr::addr_of_mut!(HEAP) as *mut u8).add(o) as *mut f64
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn heap_reset() {
    unsafe { OFFSET = 0 }
}

#[unsafe(no_mangle)]
pub extern "C" fn heap_used() -> usize {
    unsafe { OFFSET }
}
