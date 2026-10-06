import { describe, expect, it } from "vitest";
import { CanonicalizationError, canonicalize, commit, DOMAIN } from "../src";

describe("canonicalize", () => {
  it("sorts keys and removes whitespace", () => {
    expect(canonicalize({ b: 1, a: { d: [3, 2], c: "x" } })).toBe('{"a":{"c":"x","d":[3,2]},"b":1}');
  });

  it("is insensitive to key insertion order", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("preserves array order", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("escapes strings like JSON", () => {
    expect(canonicalize('a"b\n')).toBe('"a\\"b\\n"');
  });

  it.each([
    ["undefined", { a: undefined }],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-0", -0],
    ["bigint", 1n],
    ["function", () => 1],
    ["Date", new Date(0)],
    ["Map", new Map()],
    ["class instance", new (class X {})()],
  ])("rejects %s", (_name, value) => {
    expect(() => canonicalize(value)).toThrow(CanonicalizationError);
  });

  it("rejects cycles but allows shared (non-cyclic) references", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalize(a)).toThrow(/cyclic/);
    const shared = { x: 1 };
    expect(canonicalize({ p: shared, q: shared })).toBe('{"p":{"x":1},"q":{"x":1}}');
  });

  it("reports the failing path", () => {
    expect(() => canonicalize({ a: [1, { b: undefined }] })).toThrow(/\.a\[1\]\.b/);
  });
});

describe("domain separation", () => {
  it("same payload under different domains yields different hashes", () => {
    const v = { description: "x" };
    expect(commit(DOMAIN.task, v)).not.toBe(commit(DOMAIN.policy, v));
  });

  it("is deterministic and 0x-lowercase-hex32", () => {
    const h = commit(DOMAIN.task, { a: 1 });
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(commit(DOMAIN.task, { a: 1 })).toBe(h);
  });
});
