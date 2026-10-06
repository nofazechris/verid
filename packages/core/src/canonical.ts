/**
 * Canonical JSON serialization.
 *
 * Follows the structure of RFC 8785 (JCS): no insignificant whitespace, object
 * keys sorted by UTF-16 code unit order, numbers serialized with the ECMAScript
 * number-to-string algorithm, strings escaped as JSON.stringify does.
 *
 * Unlike JSON.stringify this is *strict*: anything that would serialize
 * ambiguously or lossily is rejected instead of silently coerced. In
 * particular `undefined`, functions, symbols, bigint, NaN, ±Infinity, -0,
 * non-plain objects (Date, Map, class instances...) and cyclic structures all
 * throw. Callers must convert such values explicitly (e.g. bigint -> string).
 *
 * Limitation (documented in docs/architecture.md): numbers are canonicalized
 * with the ES algorithm, so other-language implementations must match that
 * output exactly. Prefer strings for large or high-precision numeric values.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export class CanonicalizationError extends Error {
  constructor(message: string, public readonly path: string) {
    super(`${message} (at ${path || "$"})`);
    this.name = "CanonicalizationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serialize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError("non-finite number", path);
      if (Object.is(value, -0)) throw new CanonicalizationError("negative zero", path);
      return JSON.stringify(value);
    case "undefined":
      throw new CanonicalizationError("undefined is not representable", path);
    case "bigint":
      throw new CanonicalizationError("bigint must be converted to a string explicitly", path);
    case "function":
    case "symbol":
      throw new CanonicalizationError(`${typeof value} is not representable`, path);
  }

  const obj = value as object;
  if (seen.has(obj)) throw new CanonicalizationError("cyclic structure", path);
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts = obj.map((item, i) => serialize(item, `${path}[${i}]`, seen));
      return `[${parts.join(",")}]`;
    }
    if (!isPlainObject(obj)) {
      throw new CanonicalizationError("only plain objects and arrays are representable", path);
    }
    const keys = Object.keys(obj).sort(); // default sort = UTF-16 code unit order
    const parts = keys.map((key) => {
      return `${JSON.stringify(key)}:${serialize(obj[key], `${path}.${key}`, seen)}`;
    });
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

/** Serialize `value` to its canonical JSON string. Throws CanonicalizationError. */
export function canonicalize(value: unknown): string {
  return serialize(value, "", new Set());
}
