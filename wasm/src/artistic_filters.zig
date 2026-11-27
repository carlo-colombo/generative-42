const std = @import("std");
const util = @import("util.zig");
const hash = @import("rng.zig").hash;

fn clampCoord(value: i64, limit: usize) usize {
    return @intCast(@max(0, @min(@as(i64, @intCast(limit)) - 1, value)));
}

fn sample(src: []const u8, width: usize, height: usize, x: i64, y: i64) [4]u8 {
    const i = (clampCoord(y, height) * width + clampCoord(x, width)) * 4;
    return .{ src[i], src[i + 1], src[i + 2], src[i + 3] };
}

fn luminance(pixel: [4]u8) f64 {
    return 0.299 * @as(f64, @floatFromInt(pixel[0])) +
        0.587 * @as(f64, @floatFromInt(pixel[1])) +
        0.114 * @as(f64, @floatFromInt(pixel[2]));
}

fn packedColor(value: u32) [3]u8 {
    return .{ @truncate(value >> 16), @truncate(value >> 8), @truncate(value) };
}

fn channel(value: f64) u8 {
    return @intFromFloat(util.roundF(util.clampF(value, 0, 255)));
}

fn write(out: []u8, index: usize, rgb: [3]u8, alpha: u8) void {
    out[index] = rgb[0];
    out[index + 1] = rgb[1];
    out[index + 2] = rgb[2];
    out[index + 3] = alpha;
}

fn halftone(src: []const u8, out: []u8, width: usize, height: usize, cell_in: f32, angle_in: f32) void {
    const cell: f64 = @max(2, cell_in);
    const angle = @as(f64, angle_in) * (std.math.pi / @as(f64, 180));
    const cosine = @cos(angle);
    const sine = @sin(angle);
    const cx = (@as(f64, @floatFromInt(width)) - 1) / 2;
    const cy = (@as(f64, @floatFromInt(height)) - 1) / 2;
    for (0..height) |y| {
        for (0..width) |x| {
            const dx = @as(f64, @floatFromInt(x)) - cx;
            const dy = @as(f64, @floatFromInt(y)) - cy;
            const px = dx * cosine + dy * sine + cx;
            const py = -dx * sine + dy * cosine + cy;
            const cell_x: i64 = @intFromFloat(@floor(px / cell));
            const cell_y: i64 = @intFromFloat(@floor(py / cell));
            const center_x = (@as(f64, @floatFromInt(cell_x)) + 0.5) * cell - cx;
            const center_y = (@as(f64, @floatFromInt(cell_y)) + 0.5) * cell - cy;
            const sx: i64 = @intFromFloat(@floor(center_x * cosine - center_y * sine + cx));
            const sy: i64 = @intFromFloat(@floor(center_x * sine + center_y * cosine + cy));
            const darkness = 1 - luminance(sample(src, width, height, sx, sy)) / 255;
            const local_x = px - (@as(f64, @floatFromInt(cell_x)) + 0.5) * cell;
            const local_y = py - (@as(f64, @floatFromInt(cell_y)) + 0.5) * cell;
            const radius = darkness * cell * 0.7071067811865476;
            const color: u8 = if (local_x * local_x + local_y * local_y <= radius * radius) 0 else 255;
            const i = (y * width + x) * 4;
            write(out, i, .{ color, color, color }, src[i + 3]);
        }
    }
}

const bayer = [_]u8{ 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 };

fn dither(src: []const u8, out: []u8, width: usize, height: usize, levels_in: f32, strength_in: f32) void {
    const levels = @max(2, @min(16, @as(u32, @intFromFloat(levels_in))));
    const strength = util.clampF(strength_in / 100, 0, 1);
    for (0..height) |y| {
        for (0..width) |x| {
            const i = (y * width + x) * 4;
            const threshold = (@as(f64, @floatFromInt(bayer[(y % 4) * 4 + x % 4])) + 0.5) / 16 - 0.5;
            var rgb: [3]u8 = undefined;
            for (0..3) |c| {
                const value: f64 = @floatFromInt(src[i + c]);
                const scaled = value / 255 * @as(f64, @floatFromInt(levels - 1));
                const quantized = util.clampF(@floor(scaled + threshold + 0.5), 0, @as(f64, @floatFromInt(levels - 1))) * 255 / @as(f64, @floatFromInt(levels - 1));
                rgb[c] = channel(value * (1 - strength) + quantized * strength);
            }
            write(out, i, rgb, src[i + 3]);
        }
    }
}

fn edgeMap(src: []const u8, out: []u8, width: usize, height: usize, threshold_in: f32, edge: [3]u8, background: [3]u8) void {
    const threshold = util.clampF(threshold_in, 0, 100) * 2.55;
    for (0..height) |y| {
        for (0..width) |x| {
            const ix: i64 = @intCast(x);
            const iy: i64 = @intCast(y);
            const tl = luminance(sample(src, width, height, ix - 1, iy - 1));
            const tc = luminance(sample(src, width, height, ix, iy - 1));
            const tr = luminance(sample(src, width, height, ix + 1, iy - 1));
            const ml = luminance(sample(src, width, height, ix - 1, iy));
            const mr = luminance(sample(src, width, height, ix + 1, iy));
            const bl = luminance(sample(src, width, height, ix - 1, iy + 1));
            const bc = luminance(sample(src, width, height, ix, iy + 1));
            const br = luminance(sample(src, width, height, ix + 1, iy + 1));
            const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
            const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
            const magnitude = @sqrt(gx * gx + gy * gy) / 4;
            const i = (y * width + x) * 4;
            write(out, i, if (magnitude >= threshold) edge else background, src[i + 3]);
        }
    }
}

fn glitch(src: []const u8, out: []u8, width: usize, height: usize, band_in: f32, strength_in: f32, seed: u32) void {
    const band_height: usize = @intFromFloat(@max(1, band_in));
    const max_shift = @as(f64, @floatFromInt(width)) * util.clampF(strength_in, 0, 100) / 100;
    for (0..height) |y| {
        const band = y / band_height;
        const noise = hash.cell(@intCast(band), 0, seed);
        const shift: i64 = @intFromFloat(util.roundF((noise * 2 - 1) * max_shift));
        for (0..width) |x| {
            const sx = @mod(@as(i64, @intCast(x)) + shift, @as(i64, @intCast(width)));
            const from = (y * width + @as(usize, @intCast(sx))) * 4;
            const to = (y * width + x) * 4;
            @memcpy(out[to .. to + 4], src[from .. from + 4]);
        }
    }
}

fn kaleidoscope(src: []const u8, out: []u8, width: usize, height: usize, segments_in: f32, rotation_in: f32) void {
    const segments = @max(2, @min(32, @as(u32, @intFromFloat(segments_in))));
    const sector = 2 * std.math.pi / @as(f64, @floatFromInt(segments));
    const rotation = @as(f64, rotation_in) * std.math.pi / @as(f64, 180);
    const cx = (@as(f64, @floatFromInt(width)) - 1) / 2;
    const cy = (@as(f64, @floatFromInt(height)) - 1) / 2;
    for (0..height) |y| {
        for (0..width) |x| {
            const dx = @as(f64, @floatFromInt(x)) - cx;
            const dy = @as(f64, @floatFromInt(y)) - cy;
            const radius = @sqrt(dx * dx + dy * dy);
            const angle = std.math.atan2(dy, dx) + rotation;
            var folded = angle - @floor(angle / sector) * sector;
            if (folded > sector / 2) folded = sector - folded;
            const sx: i64 = @intFromFloat(@floor(cx + radius * @cos(folded - rotation) + 0.5));
            const sy: i64 = @intFromFloat(@floor(cy + radius * @sin(folded - rotation) + 0.5));
            const pixel = sample(src, width, height, sx, sy);
            write(out, (y * width + x) * 4, pixel[0..3].*, pixel[3]);
        }
    }
}

fn duotone(src: []const u8, out: []u8, width: usize, height: usize, shadow: [3]u8, highlight: [3]u8) void {
    for (0..width * height) |pixel| {
        const i = pixel * 4;
        const light = luminance(.{ src[i], src[i + 1], src[i + 2], src[i + 3] }) / 255;
        const rgb = [3]u8{
            channel(@as(f64, @floatFromInt(shadow[0])) * (1 - light) + @as(f64, @floatFromInt(highlight[0])) * light),
            channel(@as(f64, @floatFromInt(shadow[1])) * (1 - light) + @as(f64, @floatFromInt(highlight[1])) * light),
            channel(@as(f64, @floatFromInt(shadow[2])) * (1 - light) + @as(f64, @floatFromInt(highlight[2])) * light),
        };
        write(out, i, rgb, src[i + 3]);
    }
}

fn ripple(src: []const u8, out: []u8, width: usize, height: usize, frequency_in: f32, strength_in: f32) void {
    const cx = (@as(f64, @floatFromInt(width)) - 1) / 2;
    const cy = (@as(f64, @floatFromInt(height)) - 1) / 2;
    const min_side = @as(f64, @floatFromInt(@min(width, height)));
    const frequency = @max(1, frequency_in);
    const amplitude = min_side * 0.08 * util.clampF(strength_in, 0, 100) / 100;
    for (0..height) |y| {
        for (0..width) |x| {
            const dx = @as(f64, @floatFromInt(x)) - cx;
            const dy = @as(f64, @floatFromInt(y)) - cy;
            const radius = @sqrt(dx * dx + dy * dy);
            const displacement = @sin(radius / min_side * frequency * 2 * std.math.pi) * amplitude;
            const scale = if (radius > 0) (radius + displacement) / radius else 1;
            const pixel = sample(src, width, height, @intFromFloat(@floor(cx + dx * scale + 0.5)), @intFromFloat(@floor(cy + dy * scale + 0.5)));
            write(out, (y * width + x) * 4, pixel[0..3].*, pixel[3]);
        }
    }
}

pub fn apply(
    source_ptr: [*]const u8,
    target_ptr: [*]u8,
    width_in: u32,
    height_in: u32,
    filter: u32,
    param1: f32,
    param2: f32,
    color_a: u32,
    color_b: u32,
    seed: u32,
) void {
    const width: usize = @intCast(width_in);
    const height: usize = @intCast(height_in);
    if (width == 0 or height == 0) return;
    const len = width * height * 4;
    const src = source_ptr[0..len];
    const out = target_ptr[0..len];
    switch (filter) {
        1 => halftone(src, out, width, height, param1, param2),
        2 => dither(src, out, width, height, param1, param2),
        3 => edgeMap(src, out, width, height, param1, packedColor(color_a), packedColor(color_b)),
        4 => glitch(src, out, width, height, param1, param2, seed),
        5 => kaleidoscope(src, out, width, height, param1, param2),
        6 => duotone(src, out, width, height, packedColor(color_a), packedColor(color_b)),
        7 => ripple(src, out, width, height, param1, param2),
        else => @memcpy(out, src),
    }
}
