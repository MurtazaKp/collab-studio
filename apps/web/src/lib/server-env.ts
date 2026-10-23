import "server-only";

/** Server-only secrets. Importing this from a client component fails the build. */
export function collabJwtSecret(): string {
  const secret = process.env.COLLAB_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("COLLAB_JWT_SECRET is missing or shorter than 32 characters");
  }
  return secret;
}
