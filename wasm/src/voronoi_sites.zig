const std = @import("std");
const util = @import("util.zig");
const rng_mod = @import("rng.zig");

const density = 0.7;
const sample_attempts = 30;
const radius_attempts = 5;

fn insertPoint(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    cell_size: f64,
    cols: usize,
    points_x: []f64,
    points_y: []f64,
    active: []u32,
    grid: []i32,
    point_count: *usize,
    active_count: *usize,
) void {
    const index = point_count.*;
    points_x[index] = x;
    points_y[index] = y;
    const gx: usize = @min(cols - 1, @as(usize, @intFromFloat(@floor(x / cell_size))));
    const rows: usize = grid.len / cols;
    const gy: usize = @min(rows - 1, @as(usize, @intFromFloat(@floor(y / cell_size))));
    grid[gy * cols + gx] = @intCast(index);
    active[active_count.*] = @intCast(index);
    point_count.* += 1;
    active_count.* += 1;
    _ = width;
    _ = height;
}

fn isTooClose(
    x: f64,
    y: f64,
    radius_sq: f64,
    cell_size: f64,
    cols: usize,
    rows: usize,
    points_x: []const f64,
    points_y: []const f64,
    grid: []const i32,
) bool {
    const gx: i64 = @intFromFloat(@floor(x / cell_size));
    const gy: i64 = @intFromFloat(@floor(y / cell_size));
    const x0 = @max(0, gx - 2);
    const x1 = @min(@as(i64, @intCast(cols - 1)), gx + 2);
    const y0 = @max(0, gy - 2);
    const y1 = @min(@as(i64, @intCast(rows - 1)), gy + 2);
    var cy = y0;
    while (cy <= y1) : (cy += 1) {
        var cx = x0;
        while (cx <= x1) : (cx += 1) {
            const index = grid[@as(usize, @intCast(cy)) * cols + @as(usize, @intCast(cx))];
            if (index < 0) continue;
            const site: usize = @intCast(index);
            const dx = points_x[site] - x;
            const dy = points_y[site] - y;
            if (dx * dx + dy * dy < radius_sq) return true;
        }
    }
    return false;
}

fn bridson(width: f64, height: f64, count: usize, radius: f64, seed: u32, points_x: []f64, points_y: []f64) usize {
    const cell_size = radius / @sqrt(@as(f64, 2));
    const cols: usize = @max(1, @as(usize, @intFromFloat(@ceil(width / cell_size))));
    const rows: usize = @max(1, @as(usize, @intFromFloat(@ceil(height / cell_size))));
    const grid = util.salloc(i32, cols * rows);
    @memset(grid, -1);
    const active = util.salloc(u32, count);
    const radius_sq = radius * radius;
    var point_count: usize = 0;
    var active_count: usize = 0;
    var random = rng_mod.Rng.init(seed);
    insertPoint(random.next() * width, random.next() * height, width, height, cell_size, cols, points_x, points_y, active, grid, &point_count, &active_count);

    while (active_count > 0 and point_count < count) {
        const slot: usize = @intFromFloat(random.next() * @as(f64, @floatFromInt(active_count)));
        const origin_index: usize = active[slot];
        const origin_x = points_x[origin_index];
        const origin_y = points_y[origin_index];
        var placed = false;
        for (0..sample_attempts) |_| {
            const angle = random.next() * std.math.pi * 2;
            const distance = radius * (1 + random.next());
            const x = origin_x + @cos(angle) * distance;
            const y = origin_y + @sin(angle) * distance;
            if (x < 0 or y < 0 or x >= width or y >= height) continue;
            if (isTooClose(x, y, radius_sq, cell_size, cols, rows, points_x[0..point_count], points_y[0..point_count], grid)) continue;
            insertPoint(x, y, width, height, cell_size, cols, points_x, points_y, active, grid, &point_count, &active_count);
            placed = true;
            break;
        }
        if (!placed) {
            active[slot] = active[active_count - 1];
            active_count -= 1;
        }
    }
    return point_count;
}

pub fn poissonSites(
    width_in: u32,
    height_in: u32,
    target_in: u32,
    seed: u32,
    xs_ptr: [*]f32,
    ys_ptr: [*]f32,
    min_distance_ptr: [*]f32,
    count_ptr: [*]u32,
) void {
    util.resetScratch();
    const width: usize = width_in;
    const height: usize = height_in;
    if (width == 0 or height == 0) {
        min_distance_ptr[0] = 1;
        count_ptr[0] = 0;
        return;
    }
    const area = width * height;
    const target: usize = @max(1, @min(target_in, area / 4));
    var radius = @max(@sqrt(density * @as(f64, @floatFromInt(area)) / @as(f64, @floatFromInt(target))), 1);
    const best_x = util.salloc(f64, target);
    const best_y = util.salloc(f64, target);
    var best_count: usize = 0;
    var best_radius = radius;

    for (0..radius_attempts) |attempt| {
        const candidate_x = util.salloc(f64, target);
        const candidate_y = util.salloc(f64, target);
        const mixed_seed = seed ^ (@as(u32, @intCast(attempt + 1)) *% 0x9e3779b9);
        const point_count = bridson(@floatFromInt(width), @floatFromInt(height), target, radius, mixed_seed, candidate_x, candidate_y);
        if (point_count == target) {
            for (0..point_count) |i| {
                xs_ptr[i] = @floatCast(candidate_x[i]);
                ys_ptr[i] = @floatCast(candidate_y[i]);
            }
            min_distance_ptr[0] = @floatCast(radius);
            count_ptr[0] = @intCast(point_count);
            return;
        }
        if (best_count == 0 or absDiff(point_count, target) < absDiff(best_count, target)) {
            best_count = point_count;
            best_radius = radius;
            @memcpy(best_x[0..point_count], candidate_x[0..point_count]);
            @memcpy(best_y[0..point_count], candidate_y[0..point_count]);
        }
        if (point_count == 0) break;
        radius *= @sqrt(@as(f64, @floatFromInt(point_count)) / @as(f64, @floatFromInt(target)));
    }
    for (0..best_count) |i| {
        xs_ptr[i] = @floatCast(best_x[i]);
        ys_ptr[i] = @floatCast(best_y[i]);
    }
    min_distance_ptr[0] = @floatCast(best_radius);
    count_ptr[0] = @intCast(best_count);
}

fn absDiff(a: usize, b: usize) usize {
    return if (a > b) a - b else b - a;
}
