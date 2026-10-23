import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const collab = origin(process.env.NEXT_PUBLIC_COLLAB_URL?.replace(/^ws/, "http"));
const wsOf = (o: string | null) => (o ? o.replace(/^http/, "ws") : null);

const connectSrc = ["'self'", supabase, wsOf(supabase), collab, wsOf(collab)].filter(Boolean).join(" ");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabase ? ` ${supabase}` : ""}`,
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  transpilePackages: ["@collabverse/shared"],
  turbopack: {
    resolveAlias: {
      // y-monaco imports the pre-0.5x path; monaco-editor 0.57's exports map
      // serves the same module at `monaco-editor/editor/editor.api.js`.
      "monaco-editor/esm/vs/editor/editor.api.js": "monaco-editor/editor/editor.api.js",
    },
  },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
