import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("opencode-plugin package", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@gigachat-agent/opencode-plugin");
  });
});
