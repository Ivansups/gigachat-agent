import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { checkPack } from "./check-pack.mjs";

type Entry = { path: string; mode: number; type?: string };
type Manifest = { dependencies?: Record<string, string>; bin?: Record<string, string> };
const check = checkPack as (entries: Entry[], manifest: Manifest) => string[];

const file = (path: string, mode = 0o644): Entry => ({ path, mode });
const good: Entry[] = [
  file("package/LICENSE"),
  file("package/README.md"),
  file("package/package.json"),
  file("package/dist/cli.mjs", 0o755),
];
const manifest: Manifest = { dependencies: { zod: "^4.0.0" }, bin: { tool: "dist/cli.mjs" } };

describe("checkPack", () => {
  it("accepts a well-formed package", () => {
    expect(check(good, manifest)).toEqual([]);
  });

  it("reports a missing LICENSE", () => {
    const entries = good.filter((e) => e.path !== "package/LICENSE");
    expect(check(entries, manifest)).toContain("missing package/LICENSE");
  });

  it("reports a missing dist output", () => {
    const entries = good.filter((e) => !e.path.startsWith("package/dist/"));
    expect(check(entries, { dependencies: {} })).toContain("missing package/dist/");
  });

  it("reports leaked sources", () => {
    const entries = [...good, file("package/src/index.ts")];
    expect(check(entries, manifest)).toContain("unexpected package/src/index.ts");
  });

  it("reports workspace: dependencies", () => {
    const bad = { ...manifest, dependencies: { core: "workspace:*" } };
    expect(check(good, bad)).toContain("workspace: dependency core");
  });

  it("reports a bin target that is not executable", () => {
    const entries = good.map((e) => (e.path.endsWith("cli.mjs") ? file(e.path, 0o644) : e));
    expect(check(entries, manifest)).toContain("bin tool is not executable: package/dist/cli.mjs");
  });

  it("ignores directory entries", () => {
    const entries = [...good, { path: "package/dist/", mode: 0o755, type: "d" }];
    expect(check(entries, manifest)).toEqual([]);
  });

  it("reports a path containing whitespace", () => {
    const entries = [...good, file("package/src/a b.ts")];
    expect(check(entries, manifest)).toContain("whitespace in path: package/src/a b.ts");
  });

  it("reports non-regular entries such as symlinks", () => {
    const entries = [...good, { path: "package/dist/link", mode: 0o777, type: "l" }];
    expect(check(entries, manifest)).toContain("non-regular entry (l): package/dist/link");
  });

  it("reports a bin target that is missing", () => {
    const entries = good.filter((e) => !e.path.endsWith("cli.mjs"));
    expect(check(entries, manifest)).toContain("bin tool target missing: package/dist/cli.mjs");
  });
});
