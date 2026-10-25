import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { invitationEmail } = await import("./invitation");

describe("invitationEmail", () => {
  const base = { inviter: "Ada", workspace: "Acme", role: "member", link: "https://app.test/invite/abc123", expiresAt: "2026-11-01T10:00:00Z" };

  it("says who invited whom, to what, as which role, with the link", () => {
    const m = invitationEmail(base);
    expect(m.subject).toBe("Ada invited you to Acme on CollabVerse");
    expect(m.html).toContain('href="https://app.test/invite/abc123"');
    expect(m.html).toContain("as a Member");
    expect(m.text).toContain("Accept the invitation: https://app.test/invite/abc123");
    expect(m.text).toContain("November 1, 2026");
  });

  it("escapes names people chose, so they can't inject HTML", () => {
    const m = invitationEmail({ ...base, inviter: '<img src=x onerror="alert(1)">', workspace: "A & B <script>" });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(m.html).toContain("A &amp; B &lt;script&gt;");
  });

  it("falls back gracefully when names are missing", () => {
    expect(invitationEmail({ ...base, inviter: "  ", workspace: "" }).subject).toBe("A teammate invited you to a workspace on CollabVerse");
  });
});
