const std = @import("std");
const util = @import("util.zig");
const rng_mod = @import("rng.zig");
const filters = @import("filters.zig");
const sort_kernel = @import("sort_kernel.zig");
const detail_kernel = @import("detail_kernel.zig");
const voronoi_sites = @import("voronoi_sites.zig");
const mask_kernel = @import("mask_kernel.zig");

const Filter = filters.Effect;

export fn poissonSites(
    width: u32,
    height: u32,
    target: u32,
    seed: u32,
    xs_ptr: [*]f32,
    ys_ptr: [*]f32,
    min_distance_ptr: [*]f32,
    count_ptr: [*]u32,
) void {
    voronoi_sites.poissonSites(width, height, target, seed, xs_ptr, ys_ptr, min_distance_ptr, count_ptr);
}

export fn pixelSort(
    source_ptr: [*]const u8,
    target_ptr: [*]u8,
    mask_ptr: [*]const u8,
    width: u32,
    height: u32,
    has_mask: u32,
    direction: u32,
    reverse: u32,
    randomness: f32,
    span_width: u32,
    contained: u32,
    jitter: f32,
    amount_enabled: u32,
    amount: f32,
    seed: u32,
) void {
    sort_kernel.sortPixels(
        source_ptr,
        target_ptr,
        mask_ptr,
        width,
        height,
        has_mask,
        direction,
        reverse,
        randomness,
        span_width,
        contained,
        jitter,
        amount_enabled,
        amount,
        seed,
    );
}

export fn maskWeight(
    output_ptr: [*]f32,
    ring_ptr: [*]const f64,
    ring_count: u32,
    width: u32,
    height: u32,
    kind: u32,
    params_ptr: [*]const f64,
    feather: f32,
    jitter: f32,
    ragged: u32,
    seed: u32,
) void {
    mask_kernel.maskWeight(output_ptr, ring_ptr, ring_count, width, height, kind, params_ptr, feather, jitter, ragged, seed);
}

export fn compositeLayer(
    result_ptr: [*]u8,
    buffer_ptr: [*]const u8,
    mask_ptr: [*]const f32,
    pixel_count: u32,
    has_mask: u32,
    ragged: u32,
    opacity_in: f32,
) void {
    const count: usize = pixel_count;
    const result = result_ptr[0 .. count * 4];
    const buffer = buffer_ptr[0 .. count * 4];
    const mask = if (has_mask != 0) mask_ptr[0..count] else &[_]f32{};
    const opacity: f64 = util.clampF(opacity_in, 0, 1);
    for (0..count) |pixel| {
        const index = pixel * 4;
        const weight: f64 = if (has_mask == 0)
            1
        else if (ragged != 0)
            (if (mask[pixel] > 0) @as(f64, 1) else 0)
        else
            mask[pixel];
        if (weight <= 0) continue;
        const layer_alpha = (@as(f64, @floatFromInt(buffer[index + 3])) / 255) * opacity * weight;
        if (layer_alpha <= 0) continue;
        const base_alpha = @as(f64, @floatFromInt(result[index + 3])) / 255;
        if (layer_alpha >= 1) {
            result[index] = buffer[index];
            result[index + 1] = buffer[index + 1];
            result[index + 2] = buffer[index + 2];
            result[index + 3] = buffer[index + 3];
            continue;
        }
        const out_alpha = layer_alpha + base_alpha * (1 - layer_alpha);
        if (out_alpha <= 0) {
            result[index] = 0;
            result[index + 1] = 0;
            result[index + 2] = 0;
            result[index + 3] = 0;
            continue;
        }
        for (0..3) |channel| {
            const out = (@as(f64, @floatFromInt(buffer[index + channel])) * layer_alpha +
                @as(f64, @floatFromInt(result[index + channel])) * base_alpha * (1 - layer_alpha)) / out_alpha;
            result[index + channel] = @intFromFloat(util.roundF(util.clampF(out, 0, 255)));
        }
        result[index + 3] = @intFromFloat(util.roundF(util.clampF(out_alpha * 255, 0, 255)));
    }
}

export fn detailNoise(
    source_ptr: [*]const u8,
    output_ptr: [*]u8,
    width: u32,
    height: u32,
    color_mode: u32,
    seed: u32,
) void {
    detail_kernel.detailNoise(source_ptr, output_ptr, width, height, color_mode, seed);
}

export fn pixelFilter(pixels_ptr: [*]u8, pixel_count: u32, filter_id: u32, level: u32) void {
    const pixels = pixels_ptr[0 .. @as(usize, pixel_count) * 4];
    const effect: Filter = switch (filter_id) {
        1 => .inverse,
        2 => .posterize,
        3 => .grayscale,
        else => .none,
    };
    const posterize_level = @max(2, @min(255, level));
    var i: usize = 0;
    while (i < pixels.len) : (i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        switch (effect) {
            .none => {},
            .inverse => {
                pixels[i] = 255 - r;
                pixels[i + 1] = 255 - g;
                pixels[i + 2] = 255 - b;
            },
            .grayscale => {
                const l = filters.luminance(r, g, b);
                pixels[i] = l;
                pixels[i + 1] = l;
                pixels[i + 2] = l;
            },
            .posterize => {
                pixels[i] = filters.posterizeChannel(r, posterize_level);
                pixels[i + 1] = filters.posterizeChannel(g, posterize_level);
                pixels[i + 2] = filters.posterizeChannel(b, posterize_level);
            },
        }
    }
}

fn fillRect(
    out: []u8,
    width: usize,
    height: usize,
    x0_in: i64,
    y0_in: i64,
    x1_in: i64,
    y1_in: i64,
    color: [3]u8,
) void {
    const max_x: i64 = @intCast(width);
    const max_y: i64 = @intCast(height);
    const x0: usize = @intCast(@max(0, @min(max_x, x0_in)));
    const y0: usize = @intCast(@max(0, @min(max_y, y0_in)));
    const x1: usize = @intCast(@max(0, @min(max_x, x1_in)));
    const y1: usize = @intCast(@max(0, @min(max_y, y1_in)));
    if (x1 <= x0 or y1 <= y0) return;
    var y = y0;
    while (y < y1) : (y += 1) {
        var i = (y * width + x0) * 4;
        var x = x0;
        while (x < x1) : (x += 1) {
            out[i] = color[0];
            out[i + 1] = color[1];
            out[i + 2] = color[2];
            out[i + 3] = 255;
            i += 4;
        }
    }
}

fn cellAverage(src: []const u8, width: usize, x0: usize, y0: usize, x1: usize, y1: usize) [3]u8 {
    var r: u64 = 0;
    var g: u64 = 0;
    var b: u64 = 0;
    var n: u64 = 0;
    var y = y0;
    while (y < y1) : (y += 1) {
        var i = (y * width + x0) * 4;
        var x = x0;
        while (x < x1) : (x += 1) {
            r += src[i];
            g += src[i + 1];
            b += src[i + 2];
            n += 1;
            i += 4;
        }
    }
    if (n == 0) return .{ 0, 0, 0 };
    return .{
        @intCast((r + n / 2) / n),
        @intCast((g + n / 2) / n),
        @intCast((b + n / 2) / n),
    };
}

fn blendBorder(color: [3]u8) [3]u8 {
    return .{
        @intFromFloat(util.roundF(@as(f64, @floatFromInt(color[0])) * 0.3 + 178.5)),
        @intFromFloat(util.roundF(@as(f64, @floatFromInt(color[1])) * 0.3 + 178.5)),
        @intFromFloat(util.roundF(@as(f64, @floatFromInt(color[2])) * 0.3 + 178.5)),
    };
}

// Fused grid render + curtain filter. Source and output are tightly packed RGBA.
export fn curtainGrid(
    src_ptr: [*]const u8,
    out_ptr: [*]u8,
    width_in: u32,
    height_in: u32,
    grid_size_in: u32,
    margin_percent: f32,
    _curtain_count_in: u32,
    curtain_extension_percent: f32,
    curtain_variation_percent: f32,
    _edge_jitter_percent: f32,
    axis: u32,
    effect_id: u32,
    seed: u32,
) void {
    util.resetScratch();
    const width: usize = width_in;
    const height: usize = height_in;
    if (width == 0 or height == 0) return;
    const len = width * height * 4;
    const src = src_ptr[0..len];
    const out = out_ptr[0..len];

    const squares = @max(2, @min(200, grid_size_in));
    const cell = @as(f64, @floatFromInt(@min(width, height))) / @as(f64, @floatFromInt(squares));
    const cols: usize = @max(1, @as(usize, @intFromFloat(@ceil(@as(f64, @floatFromInt(width)) / cell - 1e-6))));
    const rows: usize = @max(1, @as(usize, @intFromFloat(@ceil(@as(f64, @floatFromInt(height)) / cell - 1e-6))));
    const cells = cols * rows;
    const averages = util.salloc([3]u8, cells);
    const curtain = util.zeroed(u8, cells);

    var total_r: u64 = 0;
    var total_g: u64 = 0;
    var total_b: u64 = 0;
    var total_n: u64 = 0;
    var row: usize = 0;
    while (row < rows) : (row += 1) {
        const y0: usize = @intFromFloat(util.roundF(@as(f64, @floatFromInt(row)) * cell));
        const y1 = @min(height, @as(usize, @intFromFloat(util.roundF(@as(f64, @floatFromInt(row + 1)) * cell))));
        var col: usize = 0;
        while (col < cols) : (col += 1) {
            const x0: usize = @intFromFloat(util.roundF(@as(f64, @floatFromInt(col)) * cell));
            const x1 = @min(width, @as(usize, @intFromFloat(util.roundF(@as(f64, @floatFromInt(col + 1)) * cell))));
            const avg = cellAverage(src, width, x0, y0, x1, y1);
            averages[row * cols + col] = avg;
            const n = (x1 - x0) * (y1 - y0);
            total_r += @as(u64, avg[0]) * n;
            total_g += @as(u64, avg[1]) * n;
            total_b += @as(u64, avg[2]) * n;
            total_n += n;
        }
    }
    if (total_n == 0) total_n = 1;
    const bg: [3]u8 = .{
        @intCast((total_r + total_n / 2) / total_n),
        @intCast((total_g + total_n / 2) / total_n),
        @intCast((total_b + total_n / 2) / total_n),
    };

    const along = if (axis == 1) cols else rows;
    const across = if (axis == 1) rows else cols;
    const extension = util.clampF(curtain_extension_percent, 0, 100) / 100;
    const variation = util.clampF(curtain_variation_percent, 0, 100) / 100;
    const has_curtain = extension > 0;
    if (has_curtain) {
        var rand = rng_mod.Rng.init(seed);
        var side: usize = 0;
        while (side < 2) : (side += 1) {
            var line: usize = 0;
            while (line < across) : (line += 1) {
                const length = util.clampF(extension + (rand.next() * 2 - 1) * variation, 0, 1);
                const span: usize = @intFromFloat(util.roundF(@as(f64, @floatFromInt(along)) * length));
                var k: usize = 0;
                while (k < span) : (k += 1) {
                    const pos = if (side == 0) k else along - 1 - k;
                    const index = if (axis == 1) line * cols + pos else pos * cols + line;
                    curtain[index] = 1;
                }
            }
        }
    }

    const margin: i64 = util.roundI(cell * util.clampF(margin_percent, 0, 40) / 100);
    // The base background is opaque white-lerped source average.
    fillRect(out, width, height, 0, 0, @intCast(width), @intCast(height), bg);
    row = 0;
    while (row < rows) : (row += 1) {
        const y0: i64 = util.roundI(@as(f64, @floatFromInt(row)) * cell);
        const y1: i64 = @intCast(@min(height, @as(usize, @intFromFloat(util.roundF(@as(f64, @floatFromInt(row + 1)) * cell)))));
        var col: usize = 0;
        while (col < cols) : (col += 1) {
            const x0: i64 = util.roundI(@as(f64, @floatFromInt(col)) * cell);
            const x1: i64 = @intCast(@min(width, @as(usize, @intFromFloat(util.roundF(@as(f64, @floatFromInt(col + 1)) * cell)))));
            const index = row * cols + col;
            const avg = averages[index];
            const border = blendBorder(avg);
            const sx0 = x0 + margin;
            fillRect(out, width, height, sx0, y0 + margin, x1, y1, border);
            fillRect(out, width, height, sx0 + 1, y0 + margin + 1, x1 - 1, y1 - 1, avg);

            if (has_curtain and curtain[index] != 0) {
                const filtered_bg = filters.apply(bg[0], bg[1], bg[2], switch (effect_id) {
                    1 => .inverse,
                    2 => .posterize,
                    3 => .grayscale,
                    else => .none,
                });
                fillRect(out, width, height, x0, y0, x1, y1, filtered_bg);
                var color = border;
                if (effect_id == 1) {
                    color = filters.apply(border[0], border[1], border[2], .inverse);
                } else if (effect_id == 2) {
                    color = filters.apply(border[0], border[1], border[2], .posterize);
                } else if (effect_id == 3) {
                    color = filters.apply(border[0], border[1], border[2], .grayscale);
                }
                fillRect(out, width, height, sx0, y0 + margin, x1, y1, color);
                var face = avg;
                if (effect_id == 1) {
                    face = filters.apply(avg[0], avg[1], avg[2], .inverse);
                } else if (effect_id == 2) {
                    face = filters.apply(avg[0], avg[1], avg[2], .posterize);
                } else if (effect_id == 3) {
                    face = filters.apply(avg[0], avg[1], avg[2], .grayscale);
                }
                fillRect(out, width, height, sx0 + 1, y0 + margin + 1, x1 - 1, y1 - 1, face);
            }
        }
    }
}

// Assign pixels to Voronoi sites and replace each cell with its source average.
export fn voronoiCells(
    pixels_ptr: [*]const u8,
    out_ptr: [*]u8,
    width_in: u32,
    height_in: u32,
    xs_ptr: [*]const f32,
    ys_ptr: [*]const f32,
    site_count_in: u32,
    min_distance: f32,
) void {
    util.resetScratch();
    const width: usize = width_in;
    const height: usize = height_in;
    const pixel_count = width * height;
    const byte_count = pixel_count * 4;
    const pixels = pixels_ptr[0..byte_count];
    const out = out_ptr[0..byte_count];
    @memset(out, 0);
    const site_count: usize = site_count_in;
    if (site_count == 0 or width == 0 or height == 0) return;

    const xs = xs_ptr[0..site_count];
    const ys = ys_ptr[0..site_count];
    const site_cell = @max(@as(f64, min_distance) / @sqrt(@as(f64, 2)), 1e-3);
    const cols: usize = @max(1, @as(usize, @intFromFloat(@ceil(@as(f64, @floatFromInt(width)) / site_cell))));
    const rows: usize = @max(1, @as(usize, @intFromFloat(@ceil(@as(f64, @floatFromInt(height)) / site_cell))));
    const grid = util.salloc(i32, cols * rows);
    @memset(grid, -1);
    for (0..site_count) |site| {
        const gx: usize = @min(cols - 1, @as(usize, @intFromFloat(@max(0, @floor(@as(f64, xs[site]) / site_cell)))));
        const gy: usize = @min(rows - 1, @as(usize, @intFromFloat(@max(0, @floor(@as(f64, ys[site]) / site_cell)))));
        const slot = gy * cols + gx;
        if (grid[slot] < 0) grid[slot] = @intCast(site);
    }

    const owner = util.salloc(u16, pixel_count);
    const sums = util.zeroed(u64, site_count * 3);
    const totals = util.zeroed(u32, site_count);
    const max_ring = @max(cols, rows);
    const radius_sq = site_cell * site_cell;

    var y: usize = 0;
    while (y < height) : (y += 1) {
        const gy: usize = @min(rows - 1, @as(usize, @intFromFloat(@as(f64, @floatFromInt(y)) / site_cell)));
        var x: usize = 0;
        while (x < width) : (x += 1) {
            const gx: usize = @min(cols - 1, @as(usize, @intFromFloat(@as(f64, @floatFromInt(x)) / site_cell)));
            var best_sq = std.math.inf(f64);
            var best: usize = 0;
            var found = false;
            var ring: usize = 0;
            while (ring <= max_ring) : (ring += 1) {
                const max_col: i64 = @intCast(cols - 1);
                const max_row: i64 = @intCast(rows - 1);
                const x0: i64 = @max(0, @as(i64, @intCast(gx)) - @as(i64, @intCast(ring)));
                const x1: i64 = @min(max_col, @as(i64, @intCast(gx)) + @as(i64, @intCast(ring)));
                const y0: i64 = @max(0, @as(i64, @intCast(gy)) - @as(i64, @intCast(ring)));
                const y1: i64 = @min(max_row, @as(i64, @intCast(gy)) + @as(i64, @intCast(ring)));
                var cy = y0;
                while (cy <= y1) : (cy += 1) {
                    var cx = x0;
                    while (cx <= x1) : (cx += 1) {
                        if (ring > 0 and cx != x0 and cx != x1 and cy != y0 and cy != y1) continue;
                        const site = grid[@as(usize, @intCast(cy)) * cols + @as(usize, @intCast(cx))];
                        if (site < 0) continue;
                        const site_index: usize = @intCast(site);
                        const dx = @as(f64, xs[site_index]) - @as(f64, @floatFromInt(x));
                        const dy = @as(f64, ys[site_index]) - @as(f64, @floatFromInt(y));
                        const distance = dx * dx + dy * dy;
                        if (distance < best_sq) {
                            best_sq = distance;
                            best = site_index;
                            found = true;
                        }
                    }
                }
                const ring_f: f64 = @floatFromInt(ring);
                if (found and best_sq <= ring_f * ring_f * radius_sq) break;
            }
            const index = y * width + x;
            owner[index] = @intCast(best);
            const pixel = index * 4;
            sums[best * 3] += pixels[pixel];
            sums[best * 3 + 1] += pixels[pixel + 1];
            sums[best * 3 + 2] += pixels[pixel + 2];
            totals[best] += 1;
        }
    }

    for (0..pixel_count) |index| {
        const site: usize = owner[index];
        const total: u64 = @max(1, totals[site]);
        const pixel = index * 4;
        out[pixel] = @intCast((sums[site * 3] + total / 2) / total);
        out[pixel + 1] = @intCast((sums[site * 3 + 1] + total / 2) / total);
        out[pixel + 2] = @intCast((sums[site * 3 + 2] + total / 2) / total);
        out[pixel + 3] = 255;
    }
}

// Batch quadrilateral color sampling from a downscaled RGBA image.
// Quads are x/y pixel coordinates in interleaved f32 values; outputs are RGB u8.
export fn sampleQuads(
    pixels_ptr: [*]const u8,
    width_in: u32,
    height_in: u32,
    quads_ptr: [*]const f32,
    count_in: u32,
    out_ptr: [*]u8,
) void {
    const width: i64 = width_in;
    const height: i64 = height_in;
    const pixels = pixels_ptr[0 .. @as(usize, @intCast(width * height)) * 4];
    const count: usize = count_in;
    const quads = quads_ptr[0 .. count * 8];
    const out = out_ptr[0 .. count * 3];
    var q: usize = 0;
    while (q < count) : (q += 1) {
        const base = q * 8;
        var min_x: f64 = std.math.inf(f64);
        var min_y: f64 = std.math.inf(f64);
        var max_x: f64 = -std.math.inf(f64);
        var max_y: f64 = -std.math.inf(f64);
        var x: [4]f64 = undefined;
        var y: [4]f64 = undefined;
        for (0..4) |i| {
            x[i] = quads[base + i * 2];
            y[i] = quads[base + i * 2 + 1];
            min_x = @min(min_x, x[i]);
            min_y = @min(min_y, y[i]);
            max_x = @max(max_x, x[i]);
            max_y = @max(max_y, y[i]);
        }
        var corners = [4]bool{ false, false, false, false };
        for (0..4) |i| {
            if (x[i] != min_x and x[i] != max_x) continue;
            if (y[i] != min_y and y[i] != max_y) continue;
            const corner = (if (x[i] == max_x) @as(usize, 1) else 0) +
                (if (y[i] == max_y) @as(usize, 2) else 0);
            corners[corner] = true;
        }
        const axis_rect = min_x != max_x and min_y != max_y and corners[0] and corners[1] and corners[2] and corners[3];
        const x0: i64 = @max(0, @as(i64, @intFromFloat(@floor(min_x))));
        const y0: i64 = @max(0, @as(i64, @intFromFloat(@floor(min_y))));
        const x1: i64 = @min(width, @as(i64, @intFromFloat(@ceil(max_x) + 1)));
        const y1: i64 = @min(height, @as(i64, @intFromFloat(@ceil(max_y) + 1)));
        var sr: u64 = 0;
        var sg: u64 = 0;
        var sb: u64 = 0;
        var n: u64 = 0;
        var py = y0;
        while (py < y1) : (py += 1) {
            var px = x0;
            while (px < x1) : (px += 1) {
                if (!axis_rect) {
                    const cx = @as(f64, @floatFromInt(px)) + 0.5;
                    const cy = @as(f64, @floatFromInt(py)) + 0.5;
                    var inside = false;
                    var j: usize = 3;
                    for (0..4) |i| {
                        if ((y[i] > cy) != (y[j] > cy) and cx < (x[j] - x[i]) * (cy - y[i]) / (y[j] - y[i]) + x[i]) inside = !inside;
                        j = i;
                    }
                    if (!inside) continue;
                }
                const idx: usize = @intCast((py * width + px) * 4);
                sr += pixels[idx];
                sg += pixels[idx + 1];
                sb += pixels[idx + 2];
                n += 1;
            }
        }
        if (n == 0) {
            out[q * 3] = 0;
            out[q * 3 + 1] = 0;
            out[q * 3 + 2] = 0;
        } else {
            out[q * 3] = @intCast((sr + n / 2) / n);
            out[q * 3 + 1] = @intCast((sg + n / 2) / n);
            out[q * 3 + 2] = @intCast((sb + n / 2) / n);
        }
    }
}
