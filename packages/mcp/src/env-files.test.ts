import { describe, expect, it } from "vitest";
import { envFileCandidates } from "./env-files.js";

describe("envFileCandidates", () => {
  it("loads only the explicit file and the user config file, never the project .env", () => {
    const files = envFileCandidates({ GIGACHAT_ENV_FILE: "/secure/giga.env" }, "/home/u");

    expect(files).toEqual(["/secure/giga.env", "/home/u/.config/gigachat/.env"]);
    expect(files).not.toContain(".env");
  });

  it("skips the explicit file when it is not set", () => {
    expect(envFileCandidates({}, "/home/u")).toEqual(["/home/u/.config/gigachat/.env"]);
  });
});
