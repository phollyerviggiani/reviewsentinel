import { createHmac, timingSafeEqual } from "node:crypto";


// verifies that a github webhook payload was actually signed with our shared secret, using the raw request body (not the parsed JSON -
// HMAC has to be computed over the exact bytes GitHub signed).
 
export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader) return false;

  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  // lengths must match before timingSafeEqual - it throws on mismatched
  // buffer lengths rather than just returning false.
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
