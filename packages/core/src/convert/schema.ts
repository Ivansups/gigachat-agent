type Schema = Record<string, unknown>;

export interface SimplifyOptions {
  maxDepth?: number;
  maxDescription?: number;
}

const DROPPED_KEYS = new Set(["$schema", "additionalProperties"]);

/** Reduces a JSON schema to the subset GigaChat handles reliably. */
export function simplifySchema(schema: Schema, options: SimplifyOptions = {}): Schema {
  const maxDepth = options.maxDepth ?? 4;
  const maxDescription = options.maxDescription ?? 300;
  return walk(schema, 1);

  function walk(node: Schema, depth: number): Schema {
    const union = (node["anyOf"] ?? node["oneOf"]) as Schema[] | undefined;
    if (Array.isArray(union)) {
      const { anyOf: _a, oneOf: _o, ...rest } = node;
      const variant = union.find((v) => v["type"] !== "null") ?? union[0] ?? {};
      return walk({ ...rest, ...variant }, depth);
    }
    if (depth > maxDepth && (node["type"] === "object" || node["properties"])) {
      return { type: "object" };
    }
    const result: Schema = {};
    for (const [key, value] of Object.entries(node)) {
      if (DROPPED_KEYS.has(key)) continue;
      if (key === "description" && typeof value === "string") {
        result[key] = value.slice(0, maxDescription);
      } else if (key === "properties" && isRecord(value)) {
        result[key] = Object.fromEntries(
          Object.entries(value).map(([name, child]) => [name, walk(child as Schema, depth + 1)]),
        );
      } else if (key === "items" && isRecord(value)) {
        result[key] = walk(value, depth + 1);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

function isRecord(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
