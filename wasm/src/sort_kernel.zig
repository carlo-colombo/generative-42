const util = @import("util.zig");
const rng_mod = @import("rng.zig");

const BUCKETS: usize = 16384;
const DENSE_RUN_LENGTH: usize = 1024;
const SortConfig = struct {
    width: usize,
    height: usize,
    horizontal: bool,
    reverse: bool,
    randomness: f64,
    span_width: usize,
    contained: bool,
    jitter: f64,
    amount_enabled: bool,
    amount: f64,
};

fn shellSort(keys: []u16, length: usize) void {
    var gap = length / 2;
    while (gap > 0) : (gap /= 2) {
        var i = gap;
        while (i < length) : (i += 1) {
            const key = keys[i];
            var j = i;
            while (j >= gap and keys[j - gap] > key) {
                keys[j] = keys[j - gap];
                j -= gap;
            }
            keys[j] = key;
        }
    }
}

fn spanLuminance(source: []const u8, line_start: usize, start: usize, count: usize, step: usize) f64 {
    var index = (line_start + start * step) * 4;
    if (count == 1) {
        return 0.299 * @as(f64, @floatFromInt(source[index])) +
            0.587 * @as(f64, @floatFromInt(source[index + 1])) +
            0.114 * @as(f64, @floatFromInt(source[index + 2]));
    }
    var red: u64 = 0;
    var green: u64 = 0;
    var blue: u64 = 0;
    for (0..count) |_| {
        red += source[index];
        green += source[index + 1];
        blue += source[index + 2];
        index += step * 4;
    }
    const divisor: f64 = @floatFromInt(count);
    return (0.299 * @as(f64, @floatFromInt(red)) +
        0.587 * @as(f64, @floatFromInt(green)) +
        0.114 * @as(f64, @floatFromInt(blue))) / divisor;
}

fn sortRun(
    source: []const u8,
    target: []u8,
    weight: ?[]const u8,
    line_start: usize,
    start: usize,
    end: usize,
    line_length: usize,
    line_amount: f64,
    step: usize,
    cfg: SortConfig,
    random: *rng_mod.Rng,
    counts: []u32,
    buckets: []u16,
    positions: []u32,
    used_buckets: []u16,
    counts_dirty: *bool,
) void {
    const run_length = end - start;
    if (run_length < 2) return;
    const span: usize = if (!cfg.amount_enabled and !cfg.contained)
        run_length
    else
        @min(run_length, @as(usize, @intFromFloat(util.roundF(@as(f64, @floatFromInt(run_length)) * line_amount / 100))));
    const skip: usize = if (cfg.randomness > 0)
        @intFromFloat(util.roundF(random.next() * @as(f64, @floatFromInt(span)) * cfg.randomness))
    else
        0;
    const sorted_length = span - skip;
    if (sorted_length < 2) return;

    var from: i64 = if (cfg.reverse)
        @as(i64, @intCast(end - span))
    else
        @as(i64, @intCast(start + skip));
    if (cfg.jitter > 0) {
        const shift = util.roundI((random.next() * 2 - 1) * cfg.jitter);
        if (cfg.contained) {
            const min_from: i64 = @intCast(start);
            const max_from: i64 = @intCast(end - sorted_length);
            from = @max(min_from, @min(max_from, from + shift));
        } else {
            const max_from: i64 = @intCast(line_length - sorted_length);
            from = @max(0, @min(max_from, from + shift));
        }
    }
    const from_u: usize = @intCast(from);
    const span_count = (sorted_length + cfg.span_width - 1) / cfg.span_width;

    if (span_count >= DENSE_RUN_LENGTH) {
        @memset(counts, 0);
        var i: usize = 0;
        var k: usize = 0;
        while (i < sorted_length) : ({ i += cfg.span_width; k += 1; }) {
            const count = @min(cfg.span_width, sorted_length - i);
            const luminance = spanLuminance(source, line_start, from_u + i, count, step);
            const bucket: usize = @min(BUCKETS - 1, @as(usize, @intFromFloat(luminance * (@as(f64, @floatFromInt(BUCKETS)) / 255.0))));
            buckets[k] = @intCast(bucket);
            counts[bucket] += 1;
        }
        var offset: u32 = 0;
        for (0..BUCKETS) |bucket| {
            const count = counts[bucket];
            counts[bucket] = offset;
            offset += count;
        }
        for (0..span_count) |span_index| {
            const bucket: usize = buckets[span_index];
            positions[counts[bucket]] = @intCast(span_index);
            counts[bucket] += 1;
        }
        counts_dirty.* = true;
    } else {
        if (counts_dirty.*) {
            @memset(counts, 0);
            counts_dirty.* = false;
        }
        var used_count: usize = 0;
        var i: usize = 0;
        var k: usize = 0;
        while (i < sorted_length) : ({ i += cfg.span_width; k += 1; }) {
            const count = @min(cfg.span_width, sorted_length - i);
            const luminance = spanLuminance(source, line_start, from_u + i, count, step);
            const bucket: usize = @min(BUCKETS - 1, @as(usize, @intFromFloat(luminance * (@as(f64, @floatFromInt(BUCKETS)) / 255.0))));
            buckets[k] = @intCast(bucket);
            if (counts[bucket] == 0) {
                used_buckets[used_count] = @intCast(bucket);
                used_count += 1;
            }
            counts[bucket] += 1;
        }
        shellSort(used_buckets, used_count);
        var offset: u32 = 0;
        for (0..used_count) |used_index| {
            const bucket: usize = used_buckets[used_index];
            const count = counts[bucket];
            counts[bucket] = offset;
            offset += count;
        }
        for (0..span_count) |span_index| {
            const bucket: usize = buckets[span_index];
            positions[counts[bucket]] = @intCast(span_index);
            counts[bucket] += 1;
        }
        for (0..used_count) |used_index| counts[used_buckets[used_index]] = 0;
    }

    if (cfg.span_width == 1) {
        for (0..sorted_length) |i| {
            const source_index = (line_start + (from_u + positions[i]) * step) * 4;
            const target_index = (line_start + (from_u + i) * step) * 4;
            target[target_index] = source[source_index];
            target[target_index + 1] = source[source_index + 1];
            target[target_index + 2] = source[source_index + 2];
            target[target_index + 3] = source[source_index + 3];
        }
        return;
    }

    var i: usize = 0;
    var k: usize = 0;
    while (i < sorted_length) : ({ i += cfg.span_width; k += 1; }) {
        const source_span = @as(usize, positions[k]) * cfg.span_width;
        const source_count = @min(cfg.span_width, sorted_length - source_span);
        var source_index = (line_start + (from_u + source_span) * step) * 4;
        var red: u64 = 0;
        var green: u64 = 0;
        var blue: u64 = 0;
        var alpha: u64 = 0;
        for (0..source_count) |_| {
            red += source[source_index];
            green += source[source_index + 1];
            blue += source[source_index + 2];
            alpha += source[source_index + 3];
            source_index += step * 4;
        }
        const divisor: f64 = @floatFromInt(source_count);
        const color = [4]u8{
            @intFromFloat(util.roundF(@as(f64, @floatFromInt(red)) / divisor)),
            @intFromFloat(util.roundF(@as(f64, @floatFromInt(green)) / divisor)),
            @intFromFloat(util.roundF(@as(f64, @floatFromInt(blue)) / divisor)),
            @intFromFloat(util.roundF(@as(f64, @floatFromInt(alpha)) / divisor)),
        };
        const target_count = @min(cfg.span_width, sorted_length - i);
        var target_index = (line_start + (from_u + i) * step) * 4;
        for (0..target_count) |_| {
            target[target_index] = color[0];
            target[target_index + 1] = color[1];
            target[target_index + 2] = color[2];
            target[target_index + 3] = color[3];
            target_index += step * 4;
        }
    }
    _ = weight;
}

pub fn sortPixels(
    source_ptr: [*]const u8,
    target_ptr: [*]u8,
    mask_ptr: [*]const u8,
    width_in: u32,
    height_in: u32,
    has_mask: u32,
    direction: u32,
    reverse_in: u32,
    randomness_in: f32,
    span_width_in: u32,
    contained_in: u32,
    jitter_in: f32,
    amount_enabled_in: u32,
    amount_in: f32,
    seed: u32,
) void {
    util.resetScratch();
    const width: usize = width_in;
    const height: usize = height_in;
    const pixel_count = width * height;
    const byte_count = pixel_count * 4;
    const source = source_ptr[0..byte_count];
    const target = target_ptr[0..byte_count];
    @memcpy(target, source);
    const weight: ?[]const u8 = if (has_mask != 0) mask_ptr[0..pixel_count] else null;
    const horizontal = direction == 0;
    const line_length = if (horizontal) width else height;
    const line_count = if (horizontal) height else width;
    const step: usize = if (horizontal) 1 else width;
    const min_side = @min(width, height);
    const amount_enabled = amount_enabled_in != 0;
    const randomness = util.clampF(randomness_in, 0, 100) / 100;
    const jitter = (util.clampF(jitter_in, 0, 100) / 100) * @as(f64, @floatFromInt(min_side));
    const span_width = @max(1, @min(64, span_width_in));
    const cfg = SortConfig{
        .width = width,
        .height = height,
        .horizontal = horizontal,
        .reverse = reverse_in != 0,
        .randomness = randomness,
        .span_width = span_width,
        .contained = contained_in != 0,
        .jitter = jitter,
        .amount_enabled = amount_enabled,
        .amount = util.clampF(amount_in, 0, 100),
    };
    const counts = util.zeroed(u32, BUCKETS);
    const buckets = util.salloc(u16, line_length);
    const positions = util.salloc(u32, line_length);
    const used_buckets = util.salloc(u16, line_length);
    var counts_dirty = false;
    var random = rng_mod.Rng.init(seed);
    for (0..line_count) |line| {
        const base = if (horizontal) line * width else line;
        const whole_run = !amount_enabled and !cfg.contained;
        const line_amount = if (whole_run)
            100
        else
            util.clampF((if (amount_enabled) cfg.amount else 100) * (random.next() * 0.3 + 0.85), 0, 100);
        if (weight == null) {
            sortRun(source, target, null, base, 0, line_length, line_length, line_amount, step, cfg, &random, counts, buckets, positions, used_buckets, &counts_dirty);
            continue;
        }
        const mask = weight.?;
        var position: usize = 0;
        while (position < line_length) {
            const pixel = base + position * step;
            if (mask[pixel] == 0) {
                position += 1;
                continue;
            }
            var end = position + 1;
            while (end < line_length and mask[base + end * step] > 0) end += 1;
            sortRun(source, target, weight, base, position, end, line_length, line_amount, step, cfg, &random, counts, buckets, positions, used_buckets, &counts_dirty);
            position = end;
        }
    }
}
