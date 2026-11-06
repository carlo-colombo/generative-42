const util = @import("util.zig");

pub const Effect = enum(u32) {
    none = 0,
    inverse = 1,
    posterize = 2,
    grayscale = 3,
};

pub inline fn luminance(r: u8, g: u8, b: u8) u8 {
    // Weights shared with pixel-sort, detail-noise and grey-squares.
    const v = 0.299 * @as(f64, @floatFromInt(r)) +
        0.587 * @as(f64, @floatFromInt(g)) +
        0.114 * @as(f64, @floatFromInt(b));
    return @intFromFloat(util.roundF(util.clampF(v, 0, 255)));
}

pub inline fn posterizeChannel(v: u8, level: u32) u8 {
    if (level < 2) return v;
    const q: u32 = (@as(u32, v) * level) >> 8;
    const scaled = q * 255;
    const denom = level - 1;
    return @intCast((scaled + denom / 2) / denom);
}

pub inline fn apply(r: u8, g: u8, b: u8, effect: Effect) [3]u8 {
    return switch (effect) {
        .none => .{ r, g, b },
        .inverse => .{ 255 - r, 255 - g, 255 - b },
        .grayscale => blk: {
            const l = luminance(r, g, b);
            break :blk .{ l, l, l };
        },
        .posterize => .{ posterizeChannel(r, 4), posterizeChannel(g, 4), posterizeChannel(b, 4) },
    };
}

// Used by sections, which filters individual slices.
pub inline fn applyLevels(r: u8, g: u8, b: u8, invert: bool, posterize: bool) [3]u8 {
    var out = [3]u8{ r, g, b };
    if (invert) out = .{ 255 - out[0], 255 - out[1], 255 - out[2] };
    if (posterize) out = .{
        posterizeChannel(out[0], 2),
        posterizeChannel(out[1], 2),
        posterizeChannel(out[2], 2),
    };
    return out;
}
