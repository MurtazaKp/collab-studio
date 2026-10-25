import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Sends app emails (workspace invitations) through your SMTP provider. Use the
 * same SMTP account as Supabase Auth (Authentication → Emails → SMTP Settings).
 * Server-only variables:
 *
 *   SMTP_HOST, SMTP_PORT (465 = TLS, 587 = STARTTLS), SMTP_USER, SMTP_PASS,
 *   SMTP_FROM, e.g. "CollabVerse <no-reply@yourdomain.com>"
 *
 * Without them, invitations still work as copyable links; nothing is emailed.
 */

export function mailerConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}

let transporter: Transporter | null = null;

function transport(): Transporter {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

export async function sendEmail(message: { to: string; subject: string; html: string; text: string }): Promise<void> {
  if (!mailerConfigured()) throw new Error("Email isn't set up.");
  await transport().sendMail({ from: process.env.SMTP_FROM, ...message });
}

/** Escapes text for HTML email bodies (names come from users). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
