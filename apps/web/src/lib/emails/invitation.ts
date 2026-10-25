import "server-only";
import { escapeHtml } from "@/lib/mailer";

const ROLE_WORDS: Record<string, string> = { admin: "an Admin", member: "a Member", viewer: "a Viewer" };

/** The workspace invitation email, as HTML and plain text. */
export function invitationEmail(input: { inviter: string; workspace: string; role: string; link: string; expiresAt: string }) {
  const inviter = input.inviter.trim() || "A teammate";
  const workspace = input.workspace.trim() || "a workspace";
  const role = ROLE_WORDS[input.role] ?? "a member";
  const expires = new Date(input.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const subject = `${inviter} invited you to ${workspace} on CollabVerse`.slice(0, 200);

  const e = { inviter: escapeHtml(inviter), workspace: escapeHtml(workspace), link: escapeHtml(input.link) };
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b1a17;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ef;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e3da;border-radius:16px;">
          <tr><td style="padding:32px 32px 8px 32px;">
            <p style="margin:0;font-size:18px;font-weight:700;letter-spacing:-0.01em;">CollabVerse</p>
          </td></tr>
          <tr><td style="padding:8px 32px 0 32px;">
            <h1 style="margin:16px 0 8px 0;font-size:24px;line-height:1.25;font-weight:700;">Join ${e.workspace}</h1>
            <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4a4740;">
              <strong style="color:#1b1a17;">${e.inviter}</strong> invited you to join <strong style="color:#1b1a17;">${e.workspace}</strong>
              on CollabVerse as ${role}. Work together live on docs, boards, chat, calendars and more.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="border-radius:10px;background:#4b4fd8;">
                <a href="${e.link}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">Accept invitation</a>
              </td>
            </tr></table>
            <p style="margin:24px 0 0 0;font-size:13px;line-height:1.6;color:#7a766c;">
              Or paste this link into your browser:<br />
              <a href="${e.link}" style="color:#4b4fd8;word-break:break-all;">${e.link}</a>
            </p>
          </td></tr>
          <tr><td style="padding:24px 32px 32px 32px;">
            <p style="margin:0;padding-top:20px;border-top:1px solid #eeebe3;font-size:12px;line-height:1.6;color:#9a968b;">
              This invitation is for this email address only and expires on ${expires}. Sign in or create an account
              with this address to accept it. If you weren't expecting it, you can ignore this email.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `${inviter} invited you to join ${workspace} on CollabVerse as ${role}.`,
    "",
    `Accept the invitation: ${input.link}`,
    "",
    `This invitation is for this email address only and expires on ${expires}.`,
    "If you weren't expecting it, you can ignore this email.",
  ].join("\n");

  return { subject, html, text };
}
