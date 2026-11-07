const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.option(
        std.builtin.Optimize,
        "optimize",
        "Optimization mode (default: fast)",
    ) orelse .fast;

    const kernels = b.addExecutable(.{
        .name = "kernels",
        .root_module = b.createModule(.{
            .root_source_file = b.path("wasm/src/kernels.zig"),
            .target = b.resolveTargetQuery(.{
                .cpu_arch = .wasm32,
                .os_tag = .freestanding,
            }),
            .optimize = optimize,
            .strip = false,
            .stack_check = false,
        }),
    });
    kernels.entry = .disabled;
    kernels.rdynamic = true;

    // The install dir is relative to the install prefix, which defaults to
    // zig-out/ at the build root, so this lands in public/wasm/kernels.wasm.
    const install_kernels = b.addInstallFileWithDir(
        kernels.getEmittedBin(),
        .{ .custom = "../public/wasm" },
        "kernels.wasm",
    );
    b.getInstallStep().dependOn(&install_kernels.step);
}
