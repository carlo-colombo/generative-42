const util = @import("util.zig");
const rng_mod = @import("rng.zig");

fn pixelLuminance(source: []const u8, pixel: usize) u32 {
    const index = pixel * 4;
    const luminance = 0.299 * @as(f64, @floatFromInt(source[index])) +
        0.587 * @as(f64, @floatFromInt(source[index + 1])) +
        0.114 * @as(f64, @floatFromInt(source[index + 2]));
    return @intCast(util.roundI(luminance));
}

fn horizontalRow(
    source: []const u8,
    width: usize,
    y: usize,
    radius: usize,
    sums: []u32,
    squares: []u32,
) void {
    var sum: u32 = 0;
    var square_sum: u32 = 0;
    const initial_end = @min(width, radius + 1);
    for (0..initial_end) |x| {
        const value = pixelLuminance(source, y * width + x);
        sum += value;
        square_sum += value * value;
    }
    var x: usize = 0;
    while (x < width) : (x += 1) {
        if (x > 0) {
            if (x > radius) {
                const removed = pixelLuminance(source, y * width + x - radius - 1);
                sum -= removed;
                square_sum -= removed * removed;
            }
            const added_x = x + radius;
            if (added_x < width) {
                const added = pixelLuminance(source, y * width + added_x);
                sum += added;
                square_sum += added * added;
            }
        }
        sums[x] = sum;
        squares[x] = square_sum;
    }
}

fn makePoissonTable(table: []u8) void {
    for (0..table.len) |i| {
        const sample = (@as(f64, @floatFromInt(i)) + 0.5) / @as(f64, @floatFromInt(table.len));
        var probability: f64 = @exp(-8.0);
        var cumulative: f64 = probability;
        var value: u32 = 0;
        while (sample > cumulative and value < 32) {
            value += 1;
            probability *= 8 / @as(f64, @floatFromInt(value));
            cumulative += probability;
        }
        table[i] = @intCast(value);
    }
}

fn poisson(random: *rng_mod.Rng, table: []const u8) u32 {
    const index: usize = @min(table.len - 1, @as(usize, @intFromFloat(random.next() * @as(f64, @floatFromInt(table.len)))));
    return table[index];
}

fn standardDeviation(sum: u64, square_sum: u64, count: usize) f64 {
    const n: f64 = @floatFromInt(count);
    const mean = @as(f64, @floatFromInt(sum)) / n;
    const mean_square = @as(f64, @floatFromInt(square_sum)) / n;
    return @sqrt(@max(0, mean_square - mean * mean));
}

fn updateVertical(
    source: []const u8,
    width: usize,
    row: usize,
    radius: usize,
    ring_width: usize,
    ring_sums: []u32,
    ring_squares: []u32,
    vertical_sums: []u64,
    vertical_squares: []u64,
    add: bool,
) void {
    const slot = (row % ring_width) * width;
    const row_sums = ring_sums[slot .. slot + width];
    const row_squares = ring_squares[slot .. slot + width];
    if (add) {
        horizontalRow(source, width, row, radius, row_sums, row_squares);
        for (0..width) |x| {
            vertical_sums[x] += row_sums[x];
            vertical_squares[x] += row_squares[x];
        }
    } else {
        for (0..width) |x| {
            vertical_sums[x] -= row_sums[x];
            vertical_squares[x] -= row_squares[x];
        }
    }
}

pub fn detailNoise(
    source_ptr: [*]const u8,
    output_ptr: [*]u8,
    width_in: u32,
    height_in: u32,
    color_mode: u32,
    seed: u32,
) void {
    util.resetScratch();
    const width: usize = width_in;
    const height: usize = height_in;
    const pixel_count = width * height;
    const byte_count = pixel_count * 4;
    const source = source_ptr[0..byte_count];
    const output = output_ptr[0..byte_count];
    if (pixel_count == 0) return;

    const radius: usize = @max(1, @as(usize, @intFromFloat(util.roundF(@as(f64, @floatFromInt(@min(width, height))) / 80))));
    const ring_width = radius * 2 + 1;
    const ring_count = ring_width * width;
    const ring_sums = util.salloc(u32, ring_count);
    const ring_squares = util.salloc(u32, ring_count);
    const vertical_sums = util.zeroed(u64, width);
    const vertical_squares = util.zeroed(u64, width);
    const details = util.salloc(f32, pixel_count);

    var max_detail: f64 = 1e-6;
    var current_start: usize = 0;
    var next_add: usize = 0;
    var y: usize = 0;
    while (y < height) : (y += 1) {
        const desired_start = if (y > radius) y - radius else 0;
        const desired_end = @min(height, y + radius + 1);
        while (current_start < desired_start) : (current_start += 1) {
            updateVertical(source, width, current_start, radius, ring_width, ring_sums, ring_squares, vertical_sums, vertical_squares, false);
        }
        while (next_add < desired_end) : (next_add += 1) {
            updateVertical(source, width, next_add, radius, ring_width, ring_sums, ring_squares, vertical_sums, vertical_squares, true);
        }
        const y_count = desired_end - desired_start;
        for (0..width) |x| {
            const x0 = if (x > radius) x - radius else 0;
            const x1 = @min(width, x + radius + 1);
            const count = (x1 - x0) * y_count;
            const detail = standardDeviation(vertical_sums[x], vertical_squares[x], count);
            details[y * width + x] = @floatCast(detail);
            max_detail = @max(max_detail, detail);
        }
    }

    const poisson_table = util.salloc(u8, 65536);
    makePoissonTable(poisson_table);
    var random = rng_mod.Rng.init(seed);
    for (0..pixel_count) |pixel| {
            const detail = @as(f64, details[pixel]) / max_detail;
            const noise = @as(f64, @floatFromInt(poisson(&random, poisson_table))) / 8;
            const value = noise * detail;
            const index = pixel * 4;
            if (color_mode != 0) {
                output[index] = @intFromFloat(util.roundF(util.clampF(@as(f64, @floatFromInt(source[index])) * value, 0, 255)));
                output[index + 1] = @intFromFloat(util.roundF(util.clampF(@as(f64, @floatFromInt(source[index + 1])) * value, 0, 255)));
                output[index + 2] = @intFromFloat(util.roundF(util.clampF(@as(f64, @floatFromInt(source[index + 2])) * value, 0, 255)));
            } else {
                const channel: u8 = @intFromFloat(util.roundF(util.clampF(value * 255, 0, 255)));
                output[index] = channel;
                output[index + 1] = channel;
                output[index + 2] = channel;
            }
            output[index + 3] = 255;
    }
}
