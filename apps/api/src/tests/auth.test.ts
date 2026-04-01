import { describe, expect, it } from "vitest";
import { signSession } from "../lib/auth.js";

describe("auth", () => {
  it("signSession returns a 3-part JWT", async () => {
    const token = await signSession(
      { sub: "0192a000-0000-7000-8000-000000000001" },
      "x".repeat(32),
    );
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.length > 0)).toBe(true);
  });
});
