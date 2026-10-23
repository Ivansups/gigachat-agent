import { describe, expect, it } from "vitest";
import { simplifySchema } from "./schema.js";

describe("simplifySchema", () => {
  it("replaces anyOf with its first non-null variant", () => {
    const result = simplifySchema({
      anyOf: [{ type: "null" }, { type: "string", description: "name" }],
    });

    expect(result).toEqual({ type: "string", description: "name" });
    expect(JSON.stringify(result)).not.toContain("anyOf");
  });

  it("replaces oneOf the same way", () => {
    const result = simplifySchema({ oneOf: [{ type: "integer" }, { type: "string" }] });

    expect(result).toEqual({ type: "integer" });
  });

  it("drops keywords GigaChat does not handle", () => {
    const result = simplifySchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string" } },
    });

    expect(result).toEqual({ type: "object", properties: { a: { type: "string" } } });
  });

  it("shortens long descriptions", () => {
    const result = simplifySchema({ type: "string", description: "x".repeat(1000) }) as {
      description: string;
    };

    expect(result.description.length).toBeLessThanOrEqual(300);
  });

  it("flattens objects nested deeper than the limit", () => {
    const deep = {
      type: "object",
      properties: {
        a: { type: "object", properties: { b: { type: "object", properties: { c: { type: "object", properties: { d: { type: "string" } } } } } } },
      },
    };

    const result = JSON.stringify(simplifySchema(deep, { maxDepth: 3 }));

    expect(result).not.toContain('"d"');
  });
});
