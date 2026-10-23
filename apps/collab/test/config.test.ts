import { describe, expect, it } from "vitest";
import { loadConfig, normalizeOrigin } from "../src/config";

const base = { COLLAB_DATABASE_URL: "postgres://x", COLLAB_JWT_SECRET: "0123456789abcdef0123456789abcdef" };

describe("allowed origins", () => {
  it("normalises configured origins so a trailing slash or case still matches", () => {
    const config = loadConfig({ ...base, COLLAB_ALLOWED_ORIGINS: " https://App.example.com/ , http://localhost:3000," });
    expect(config.allowedOrigins).toEqual(["https://app.example.com", "http://localhost:3000"]);
  });

  it("strips quotes pasted around a value", () => {
    expect(normalizeOrigin('"https://app.example.com/"')).toBe("https://app.example.com");
  });
});
