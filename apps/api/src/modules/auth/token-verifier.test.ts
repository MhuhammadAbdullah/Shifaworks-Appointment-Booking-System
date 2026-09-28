import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK, type CryptoKey } from "jose";
import { createTokenVerifier } from "./token-verifier.js";
import { AppError } from "../../utils/app-error.js";

const ISSUER = "https://proj.supabase.co/auth/v1";
const AUDIENCE = "authenticated";
const HS_SECRET = "legacy-hs256-secret-with-enough-length-0123456789";
const SUB = "3f1d6c52-6b1e-4c8f-9b8a-2f4a1f0b9c11";

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let verify: ReturnType<typeof createTokenVerifier>;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair("ES256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  verify = createTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwks: createLocalJWKSet({ keys: [jwk] }),
    hs256Secret: HS_SECRET,
  });
});

function es256(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; exp?: string | number; iss?: string; aud?: string } = {}) {
  return new SignJWT({ email: "Person@Example.com", session_id: "s1", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setSubject(SUB)
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

async function expectUnauthenticated(p: Promise<unknown>, message?: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe("UNAUTHENTICATED");
  if (message) expect((err as AppError).message).toMatch(message);
}

describe("createTokenVerifier", () => {
  it("accepts a valid asymmetric Supabase token and normalises the email", async () => {
    const result = await verify(await es256());
    expect(result.sub).toBe(SUB);
    expect(result.email).toBe("person@example.com");
    expect(result.sessionId).toBe("s1");
  });

  it("accepts legacy HS256 tokens when the secret is configured", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(SUB)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(HS_SECRET));
    expect((await verify(token)).sub).toBe(SUB);
  });

  it("rejects HS256 tokens when no secret is configured (alg confusion)", async () => {
    const strict = createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks: createLocalJWKSet({ keys: [] }) });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(SUB)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(HS_SECRET));
    await expectUnauthenticated(strict(token));
  });

  it("rejects a token signed by an unknown key", async () => {
    await expectUnauthenticated(verify(await es256({}, { key: otherPrivateKey })), /invalid/i);
  });

  it("rejects expired tokens with a clear message", async () => {
    const expired = await es256({}, { exp: Math.floor(Date.now() / 1000) - 60 });
    await expectUnauthenticated(verify(expired), /expired/i);
  });

  it("rejects wrong issuer and wrong audience", async () => {
    await expectUnauthenticated(verify(await es256({}, { iss: "https://evil.example/auth/v1" })));
    await expectUnauthenticated(verify(await es256({}, { aud: "anon" })));
  });

  it("rejects anonymous sessions", async () => {
    await expectUnauthenticated(verify(await es256({ is_anonymous: true })), /anonymous/i);
  });

  it("rejects garbage and alg=none tokens", async () => {
    await expectUnauthenticated(verify("not-a-jwt"), /malformed/i);
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: SUB, iss: ISSUER, aud: AUDIENCE })).toString("base64url");
    await expectUnauthenticated(verify(`${header}.${body}.`));
  });
});
