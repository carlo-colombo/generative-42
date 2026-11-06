const PAGE_SIZE: usize = 65536;
var heap_base: usize = 0;
var heap_top: usize = 0;
var scratch_base: usize = 0;

fn initializeHeap() void {
    if (heap_base != 0) return;
    heap_base = @wasmMemorySize(0) * PAGE_SIZE;
    heap_top = heap_base;
    scratch_base = heap_base;
}

fn allocate(bytes_in: usize) usize {
    initializeHeap();
    const ptr = (heap_top + 7) & ~@as(usize, 7);
    const bytes = @max(bytes_in, 1);
    const end = ptr + bytes;
    const pages_needed = (end + PAGE_SIZE - 1) / PAGE_SIZE;
    const current_pages = @wasmMemorySize(0);
    if (pages_needed > current_pages) {
        if (@wasmMemoryGrow(0, pages_needed - current_pages) < 0) @trap();
    }
    heap_top = end;
    return ptr;
}

// Buffers the JS side keeps until the next pfree call.
export fn palloc(bytes: u32) usize {
    return allocate(bytes);
}

export fn pfree() void {
    initializeHeap();
    heap_top = heap_base;
    scratch_base = 0;
}

// Temporary storage allocated within one kernel call and reused by the next.
pub fn resetScratch() void {
    initializeHeap();
    if (scratch_base == 0) scratch_base = heap_top;
    heap_top = scratch_base;
}

export fn sreset() void {
    resetScratch();
}

pub fn salloc(comptime T: type, n: usize) []T {
    const ptr = allocate(n * @sizeOf(T));
    return @as([*]T, @ptrFromInt(ptr))[0..n];
}

pub fn zeroed(comptime T: type, n: usize) []T {
    const out = salloc(T, n);
    @memset(out, 0);
    return out;
}

pub inline fn clamp01(value: f64) f64 {
    return if (value < 0) 0 else if (value > 1) 1 else value;
}

pub inline fn clampF(value: f64, low: f64, high: f64) f64 {
    return if (value < low) low else if (value > high) high else value;
}

// JS Math.round: half away from zero.
pub inline fn roundF(value: f64) f64 {
    return @floor(value + 0.5);
}

pub inline fn roundI(value: f64) i64 {
    return @intFromFloat(@floor(value + 0.5));
}
