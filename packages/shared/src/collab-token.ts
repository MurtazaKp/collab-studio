import { SignJWT, jwtVerify, errors } from "jose";
import { parseRoomName } from "./rooms";

/**
 * Short-lived credentials for the collaboration server.
 *
 * The web app issues a token only after checking (with the user's own RLS-scoped
 * session) that the user can see the room. The collaboration server verifies the
 * signature and expiry, then re-checks membership against the database itself,
 * so a leaked token is useless once membership is revoked or the token expires.
 */
export const COLLAB_TOKEN_ISSUER = "collabverse-web";
export const COLLAB_TOKEN_AUDIENCE = "collabverse-collab";
export const COLLAB_TOKEN_TTL_SECONDS = 120;

export interface CollabTokenClaims {
  /** Supabase auth user id. */
  userId: string;
  /** Room the token is valid for. */
  room: string;
  /** Display info for awareness only; never used for authorization. */
  name?: string;
}

function keyFrom(secret: string): Uint8Array {
  if (!secret || secret.length < 32) {
    throw new Error("COLLAB_JWT_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function signCollabToken(
  claims: CollabTokenClaims,
  secret: string,
  ttlSeconds: number = COLLAB_TOKEN_TTL_SECONDS,
): Promise<string> {
  if (!parseRoomName(claims.room)) throw new Error("Invalid room name");
  return new SignJWT({ room: claims.room, name: claims.name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(COLLAB_TOKEN_ISSUER)
    .setAudience(COLLAB_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(keyFrom(secret));
}

export type VerifyResult =
  | { ok: true; claims: CollabTokenClaims }
  | { ok: false; reason: "expired" | "invalid" | "room_mismatch" };

export async function verifyCollabToken(
  token: string,
  expectedRoom: string,
  secret: string,
): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, keyFrom(secret), {
      issuer: COLLAB_TOKEN_ISSUER,
      audience: COLLAB_TOKEN_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || typeof payload.room !== "string") {
      return { ok: false, reason: "invalid" };
    }
    if (payload.room !== expectedRoom) return { ok: false, reason: "room_mismatch" };
    return {
      ok: true,
      claims: {
        userId: payload.sub,
        room: payload.room,
        name: typeof payload.name === "string" ? payload.name : undefined,
      },
    };
  } catch (err) {
    if (err instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}
