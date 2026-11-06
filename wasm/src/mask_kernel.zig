const std = @import("std");
const util = @import("util.zig");

fn hashCell(x: i32, y: i32, seed: u32) f64 {
    var hash = seed ^ (@as(u32, @bitCast(x)) *% 0x27d4eb2d) ^ (@as(u32, @bitCast(y)) *% 0x165667b1);
    hash = (hash ^ (hash >> 15)) *% 0x2c1b3c6d;
    hash = (hash ^ (hash >> 13)) *% 0x297a2d39;
    return @as(f64, @floatFromInt(hash ^ (hash >> 16))) / 4294967296.0;
}

fn valueNoise(x: f64, y: f64, cell: f64, seed: u32) f64 {
    const gx = x / cell;
    const gy = y / cell;
    const ix: i32 = @intFromFloat(@floor(gx));
    const iy: i32 = @intFromFloat(@floor(gy));
    var fx = gx - @as(f64, @floatFromInt(ix));
    var fy = gy - @as(f64, @floatFromInt(iy));
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const n00 = hashCell(ix, iy, seed);
    const n10 = hashCell(ix + 1, iy, seed);
    const n01 = hashCell(ix, iy + 1, seed);
    const n11 = hashCell(ix + 1, iy + 1, seed);
    const nx0 = n00 + (n10 - n00) * fx;
    const nx1 = n01 + (n11 - n01) * fx;
    return nx0 + (nx1 - nx0) * fy;
}

fn raggedNoise(x: f64, y: f64, cell: f64, seed: u32) f64 {
    const coarse = valueNoise(x, y, cell, seed);
    const fine = valueNoise(x, y, @max(1, cell / 3), seed ^ 0x9e3779b9);
    return (coarse * 0.7 + fine * 0.3) * 2 - 1;
}

fn edgeValue(distance: f64, feather: f64, jitter: f64, x: f64, y: f64, cell: f64, seed: u32) f64 {
    var adjusted = distance;
    if (jitter > 0) adjusted += jitter * raggedNoise(x, y, cell, seed);
    if (adjusted <= 0) return 0;
    if (feather <= 0 or adjusted >= feather) return 1;
    const t = adjusted / feather;
    return t * t * (3 - 2 * t);
}

fn analyticRect(params: []const f64, width: usize, height: usize, x: f64, y: f64) f64 {
    const cx = (params[0] + params[2] / 2) * @as(f64, @floatFromInt(width));
    const cy = (params[1] + params[3] / 2) * @as(f64, @floatFromInt(height));
    const half_width = @max(0, params[2] * @as(f64, @floatFromInt(width)) / 2);
    const half_height = @max(0, params[3] * @as(f64, @floatFromInt(height)) / 2);
    const angle = -params[4] * std.math.pi / 180;
    const cosine = @cos(angle);
    const sine = @sin(angle);
    const dx = x - cx;
    const dy = y - cy;
    const local_x = @abs(dx * cosine - dy * sine);
    const local_y = @abs(dx * sine + dy * cosine);
    const over_x = local_x - half_width;
    const over_y = local_y - half_height;
    if (over_x <= 0 and over_y <= 0) return @min(-over_x, -over_y);
    return -@sqrt(@max(over_x, 0) * @max(over_x, 0) + @max(over_y, 0) * @max(over_y, 0));
}

fn analyticEllipse(params: []const f64, width: usize, height: usize, x: f64, y: f64) f64 {
    const canvas_width: f64 = @floatFromInt(width);
    const canvas_height: f64 = @floatFromInt(height);
    const cx = params[0] * canvas_width;
    const cy = params[1] * canvas_height;
    const rx = @max(1e-6, params[2] * canvas_width);
    const ry = @max(1e-6, params[3] * canvas_height);
    const angle = -params[4] * std.math.pi / 180;
    const cosine = @cos(angle);
    const sine = @sin(angle);
    const dx = x - cx;
    const dy = y - cy;
    const local_x = dx * cosine - dy * sine;
    const local_y = dx * sine + dy * cosine;
    const u = local_x / rx;
    const v = local_y / ry;
    const radius = @sqrt(u * u + v * v);
    if (radius < 1e-9) return @min(rx, ry);
    const length = @sqrt(local_x * local_x + local_y * local_y);
    return length * (1 - radius) / radius;
}

fn sortIntersections(values: []f64, count: usize) void {
    var gap = count / 2;
    while (gap > 0) : (gap /= 2) {
        var i = gap;
        while (i < count) : (i += 1) {
            const value = values[i];
            var j = i;
            while (j >= gap and values[j - gap] > value) {
                values[j] = values[j - gap];
                j -= gap;
            }
            values[j] = value;
        }
    }
}

fn pathMask(
    output: []f32,
    width: usize,
    height: usize,
    ring: []const f64,
    edge_count: usize,
    feather: f64,
    jitter: f64,
    cell: f64,
    seed: u32,
) void {
    const intersections = util.salloc(f64, edge_count);
    for (0..height) |y| {
        const py: f64 = @as(f64, @floatFromInt(y)) + 0.5;
        var crossing_count: usize = 0;
        for (0..edge_count) |edge| {
            const next = (edge + 1) % edge_count;
            const x0 = ring[edge * 2];
            const y0 = ring[edge * 2 + 1];
            const x1 = ring[next * 2];
            const y1 = ring[next * 2 + 1];
            if ((y0 > py) != (y1 > py)) {
                intersections[crossing_count] = (x1 - x0) * (py - y0) / (y1 - y0) + x0;
                crossing_count += 1;
            }
        }
        sortIntersections(intersections, crossing_count);
        var pair: usize = 0;
        while (pair + 1 < crossing_count) : (pair += 2) {
            const left = intersections[pair];
            const right = intersections[pair + 1];
            const from = @max(0, @as(i64, @intFromFloat(@floor(left - 0.5) + 1)));
            const to = @max(0, @min(@as(i64, @intCast(width)), @as(i64, @intFromFloat(@ceil(right - 0.5)))));
            var x: usize = @intCast(from);
            const end: usize = @intCast(to);
            while (x < end) : (x += 1) output[y * width + x] = 1;
        }
    }
    if (feather <= 0 and jitter <= 0) return;

    const infinity: f32 = std.math.inf(f32);
    for (0..output.len) |i| output[i] = if (output[i] > 0) infinity else -infinity;
    const margin = feather + jitter;
    const margin_sq = margin * margin;
    for (0..edge_count) |edge| {
        const next = (edge + 1) % edge_count;
        const x0 = ring[edge * 2];
        const y0 = ring[edge * 2 + 1];
        const x1 = ring[next * 2];
        const y1 = ring[next * 2 + 1];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const length_sq = dx * dx + dy * dy;
        if (length_sq == 0) continue;
        const start_x: usize = @intCast(@max(0, @as(i64, @intFromFloat(@floor(@min(x0, x1) - margin)))));
        const end_x: usize = @intCast(@max(0, @min(@as(i64, @intCast(width)), @as(i64, @intFromFloat(@ceil(@max(x0, x1) + margin) + 1)))));
        const start_y: usize = @intCast(@max(0, @as(i64, @intFromFloat(@floor(@min(y0, y1) - margin)))));
        const end_y: usize = @intCast(@max(0, @min(@as(i64, @intCast(height)), @as(i64, @intFromFloat(@ceil(@max(y0, y1) + margin) + 1)))));
        var y = start_y;
        while (y < end_y) : (y += 1) {
            const py: f64 = @as(f64, @floatFromInt(y)) + 0.5;
            var x = start_x;
            while (x < end_x) : (x += 1) {
                const px: f64 = @as(f64, @floatFromInt(x)) + 0.5;
                const t = util.clampF(((px - x0) * dx + (py - y0) * dy) / length_sq, 0, 1);
                const offset_x = px - (x0 + t * dx);
                const offset_y = py - (y0 + t * dy);
                const distance_sq = offset_x * offset_x + offset_y * offset_y;
                if (distance_sq >= margin_sq) continue;
                const index = y * width + x;
                const current = @as(f64, output[index]);
                if (distance_sq < @abs(current)) {
                    output[index] = @floatCast((if (current > 0) @as(f64, 1) else -1) * distance_sq);
                }
            }
        }
    }

    for (0..output.len) |index| {
        const signed_sq = @as(f64, output[index]);
        if (@abs(signed_sq) >= margin_sq) {
            output[index] = if (signed_sq > 0) 1 else 0;
            continue;
        }
        const sign: f64 = if (signed_sq > 0) 1 else -1;
        const x: f64 = @as(f64, @floatFromInt(index % width)) + 0.5;
        const y: f64 = @as(f64, @floatFromInt(index / width)) + 0.5;
        output[index] = @floatCast(edgeValue(sign * @sqrt(@abs(signed_sq)), feather, jitter, x, y, cell, seed));
    }
}

pub fn maskWeight(
    output_ptr: [*]f32,
    ring_ptr: [*]const f64,
    ring_count_in: u32,
    width_in: u32,
    height_in: u32,
    kind: u32,
    params_ptr: [*]const f64,
    feather_percent: f32,
    jitter_percent: f32,
    ragged: u32,
    seed: u32,
) void {
    util.resetScratch();
    const width: usize = width_in;
    const height: usize = height_in;
    const pixel_count = width * height;
    const output = output_ptr[0..pixel_count];
    @memset(output, 0);
    const ring_count: usize = ring_count_in;
    if (ring_count < 3 or width == 0 or height == 0) return;
    const ring = ring_ptr[0 .. ring_count * 2];
    const params = params_ptr[0..5];
    const min_side: f64 = @floatFromInt(@min(width, height));
    const feather = util.clampF(feather_percent, 0, 100000) / 100 * min_side;
    const jitter = if (ragged != 0) util.clampF(jitter_percent, 0, 100000) / 100 * min_side else 0;
    const cell = @max(2, util.roundF(min_side / 128));
    if (kind == 0) {
        pathMask(output, width, height, ring, ring_count, feather, jitter, cell, seed);
        return;
    }
    var min_x = std.math.inf(f64);
    var min_y = std.math.inf(f64);
    var max_x = -std.math.inf(f64);
    var max_y = -std.math.inf(f64);
    for (0..ring_count) |i| {
        min_x = @min(min_x, ring[i * 2]);
        min_y = @min(min_y, ring[i * 2 + 1]);
        max_x = @max(max_x, ring[i * 2]);
        max_y = @max(max_y, ring[i * 2 + 1]);
    }
    const margin = feather + jitter;
    const start_x: usize = @intCast(@max(0, @as(i64, @intFromFloat(@floor(min_x - margin)))));
    const end_x: usize = @intCast(@max(0, @min(@as(i64, @intCast(width)), @as(i64, @intFromFloat(@ceil(max_x + margin))))));
    const start_y: usize = @intCast(@max(0, @as(i64, @intFromFloat(@floor(min_y - margin)))));
    const end_y: usize = @intCast(@max(0, @min(@as(i64, @intCast(height)), @as(i64, @intFromFloat(@ceil(max_y + margin))))));

    var y: usize = start_y;
    while (y < end_y) : (y += 1) {
        const py: f64 = @as(f64, @floatFromInt(y)) + 0.5;
        const row = y * width;
        var x: usize = start_x;
        while (x < end_x) : (x += 1) {
            const px: f64 = @as(f64, @floatFromInt(x)) + 0.5;
            const distance = if (kind == 1)
                analyticRect(params, width, height, px, py)
            else
                analyticEllipse(params, width, height, px, py);
            output[row + x] = @floatCast(edgeValue(distance, feather, jitter, px, py, cell, seed));
        }
    }
}
