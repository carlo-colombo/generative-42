// mulberry32, matching src/areas.ts so a seed drives both implementations.
pub const Rng = struct {
    state: u32,

    pub fn init(seed: u32) Rng {
        return .{ .state = seed };
    }

    pub fn next(self: *Rng) f64 {
        self.state +%= 0x6d2b79f5;
        var t: u32 = self.state;
        t = (t ^ (t >> 15)) *% (t | 1);
        t ^= t +% ((t ^ (t >> 7)) *% (t | 61));
        return @as(f64, @floatFromInt(t ^ (t >> 14))) / 4294967296.0;
    }
};

pub const hash = struct {
    // Same avalanche as areas.ts hashCell, used by the ragged mask noise.
    pub fn cell(x: i32, y: i32, seed: u32) f64 {
        var h: u32 = seed ^ (@as(u32, @bitCast(x)) *% 0x27d4eb2d) ^ (@as(u32, @bitCast(y)) *% 0x165667b1);
        h = (h ^ (h >> 15)) *% 0x2c1b3c6d;
        h = (h ^ (h >> 13)) *% 0x297a2d39;
        return @as(f64, @floatFromInt(h ^ (h >> 16))) / 4294967296.0;
    }
};
