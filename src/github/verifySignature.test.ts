// test file for verifySignature.ts

import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGithubSignature } from "./verifySignature.js";

describe("verifyGithubSignature", () => {
  const secret = "test-secret";

  function sign(payload: string, withSecret = secret): string {
    return "sha256=" + createHmac("sha256", withSecret).update(payload).digest("hex");
  }

  it("accepts a correctly signed payload", () => {
    const payload = JSON.stringify({ hello: "world" });
    expect(verifyGithubSignature(payload, sign(payload), secret)).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", () => {
    const payload = JSON.stringify({ hello: "world" });
    expect(verifyGithubSignature(payload, sign(payload, "wrong-secret"), secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    const payload = JSON.stringify({ hello: "world" });
    expect(verifyGithubSignature(payload, undefined, secret)).toBe(false);
  });

  it("rejects a tampered payload (signature valid for different content)", () => {
    const original = JSON.stringify({ hello: "world" });
    const tampered = JSON.stringify({ hello: "world!" });
    expect(verifyGithubSignature(tampered, sign(original), secret)).toBe(false);
  });

  it("rejects a garbage signature header", () => {
    const payload = JSON.stringify({ hello: "world" });
    expect(verifyGithubSignature(payload, "not-a-real-signature", secret)).toBe(false);
  });
});
