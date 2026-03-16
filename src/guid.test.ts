import { describe, it, expect } from "vitest";
import { dotPathToGuid, guidToDotPath } from "./guid.js";

describe("dotPathToGuid", () => {
  it("converts single segment", () => {
    expect(dotPathToGuid("1")).toBe("01000000-0000-0000-0000-000000000000");
  });

  it("converts two segments", () => {
    expect(dotPathToGuid("1.1")).toBe("01010000-0000-0000-0000-000000000000");
    expect(dotPathToGuid("1.2")).toBe("01020000-0000-0000-0000-000000000000");
    expect(dotPathToGuid("2.1")).toBe("02010000-0000-0000-0000-000000000000");
  });

  it("converts three segments", () => {
    expect(dotPathToGuid("2.3.1")).toBe("02030100-0000-0000-0000-000000000000");
  });

  it("converts four segments", () => {
    expect(dotPathToGuid("3.1.4.1")).toBe(
      "03010401-0000-0000-0000-000000000000"
    );
  });

  it("throws for invalid segments", () => {
    expect(() => dotPathToGuid("256")).toThrow("0-255");
    expect(() => dotPathToGuid("a.b")).toThrow("0-255");
  });
});

describe("guidToDotPath", () => {
  it("converts back to single segment", () => {
    expect(guidToDotPath("01000000-0000-0000-0000-000000000000")).toBe("1");
  });

  it("converts back to two segments", () => {
    expect(guidToDotPath("02010000-0000-0000-0000-000000000000")).toBe("2.1");
  });

  it("converts back to three segments", () => {
    expect(guidToDotPath("02030100-0000-0000-0000-000000000000")).toBe("2.3.1");
  });

  it("round-trips", () => {
    const paths = ["1", "1.1", "2.3.1", "3.1.4.1", "10.20.30"];
    for (const p of paths) {
      expect(guidToDotPath(dotPathToGuid(p))).toBe(p);
    }
  });

  it("throws for all zeros", () => {
    expect(() =>
      guidToDotPath("00000000-0000-0000-0000-000000000000")
    ).toThrow("all zeros");
  });
});
