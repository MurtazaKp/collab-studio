import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { MODULES, MODULE_TYPES } from "@collabverse/shared";
import { getCurrentUser } from "@/lib/auth";
import { ModuleIcon } from "@/components/ui/module-icon";
import { DASHBOARD_HREF, SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { ProductPreview } from "@/components/marketing/product-preview";
import { ctaClass } from "@/components/marketing/cta";
import { PLANS, TRIAL_NOTE } from "@/components/marketing/plans";

const REASONS = [
  {
    title: "Simple on purpose",
    body: "Eight focused tools instead of a hundred settings. Create a workspace, invite your team and start working in minutes, with no configuration maze to get through first.",
  },
  {
    title: "Live by default",
    body: "Cursors, presence and edits sync instantly between everyone in the workspace. No refresh button, no “who has the latest version?”.",
  },
  {
    title: "One flat price",
    body: "You pay per account, not per seat. Adding your twelfth colleague doesn’t change the bill.",
  },
  {
    title: "Private by default",
    body: "Every row is protected by Postgres row-level security. Owner, Admin, Member and Viewer roles decide who can see and change what.",
  },
];

export default async function LandingPage() {
  // Signed-in visitors can read the landing page too; the calls to action
  // take them to their dashboard instead of sign-up.
  const signedIn = Boolean(await getCurrentUser());
  const team = PLANS.find((p) => p.id === "team")!;

  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader signedIn={signedIn} />

      <main>
        {/* Hero */}
        <section aria-labelledby="hero-title" className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 lg:pt-20">
          <div className="max-w-3xl">
            <p className="text-[13px] font-medium tracking-wide text-accent uppercase">For teams of 5 to 50</p>
            <h1
              id="hero-title"
              className="mt-4 font-display text-[44px] leading-[1.02] tracking-tight text-balance text-text sm:text-[64px] lg:text-[76px]"
            >
              The whole office, on the same page.
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-text-2">
              CollabVerse is one workspace for docs, whiteboards, boards, chat, mindmaps, shared code, playlists and
              to-do lists. Everything is live: you see who&apos;s here, where they&apos;re working and what
              they change, as it happens.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={signedIn ? DASHBOARD_HREF : "/signup"} className={ctaClass("primary", "lg")}>
                {signedIn ? "Go to your dashboard" : "Start free trial"}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
              <Link href="/pricing" className={ctaClass("outline", "lg")}>
                See pricing
              </Link>
            </div>
            {signedIn ? null : <p className="mt-4 text-[13px] text-text-2">{TRIAL_NOTE}</p>}
          </div>

          <div id="product" className="mt-14 scroll-mt-6 lg:mt-16">
            <ProductPreview />
          </div>
        </section>

        {/* Tools */}
        <section aria-labelledby="tools-title" className="mx-auto mt-24 max-w-6xl px-4 sm:px-6 lg:mt-32">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
            <div className="lg:sticky lg:top-10 lg:self-start">
              <p className="font-mono text-[12px] text-muted">01 / The workspace</p>
              <h2 id="tools-title" className="mt-3 font-display text-[36px] leading-[1.08] tracking-tight text-text sm:text-[44px]">
                Eight tools. One login. Nothing to wire together.
              </h2>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-text-2">
                The things a small office actually uses every week, built to work the same way and to share the
                same people, roles and presence.
              </p>
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {MODULE_TYPES.map((t, i) => (
                <li key={t} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 py-5 sm:grid-cols-[3rem_auto_minmax(0,1fr)]">
                  <span aria-hidden className="hidden pt-1 font-mono text-[12px] text-muted sm:block">
                    0{i + 1}
                  </span>
                  <ModuleIcon type={t} tile />
                  <div>
                    <h3 className="text-[16px] font-semibold text-text">{MODULES[t].label}</h3>
                    <p className="mt-1 text-[14px] leading-relaxed text-text-2">{MODULES[t].description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Why */}
        <section aria-labelledby="why-title" className="mt-24 border-y border-border bg-surface lg:mt-32">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
            <p className="font-mono text-[12px] text-muted">02 / Why CollabVerse</p>
            <h2 id="why-title" className="mt-3 max-w-2xl font-display text-[36px] leading-[1.08] tracking-tight text-text sm:text-[44px]">
              Less to learn than the big all-in-one suites. More happening in real time.
            </h2>
            <ol className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2">
              {REASONS.map((r, i) => (
                <li key={r.title} className="border-t border-border pt-5">
                  <span aria-hidden className="font-display text-[28px] leading-none text-accent">
                    {i + 1}.
                  </span>
                  <h3 className="mt-3 text-[17px] font-semibold text-text">{r.title}</h3>
                  <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-text-2">{r.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pricing teaser */}
        <section aria-labelledby="price-title" className="mx-auto mt-24 max-w-6xl px-4 sm:px-6 lg:mt-32">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
            <div>
              <p className="font-mono text-[12px] text-muted">03 / Pricing</p>
              <h2 id="price-title" className="mt-3 font-display text-[36px] leading-[1.08] tracking-tight text-text sm:text-[44px]">
                One price for the workspace, not for every person in it.
              </h2>
              <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-text-2">
                Start on Free with up to 3 people. Move to Team or Business when the office joins. Annual billing
                gets you two months free.
              </p>
              <Link
                href="/pricing"
                className="mt-6 inline-flex items-center gap-1.5 rounded-sm text-[15px] font-medium text-accent underline-offset-4 hover:underline"
              >
                Compare all plans
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>
            <div className="rounded-xl border border-border bg-surface p-6 shadow-md sm:p-8">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-[15px] font-semibold text-text">{team.name}</h3>
                <span className="text-[13px] text-text-2">{team.people}</span>
              </div>
              <p className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-[64px] leading-none tracking-tight text-text">${team.monthly}</span>
                <span className="text-[14px] text-text-2">per month</span>
              </p>
              <p className="mt-3 text-[13.5px] text-text-2">
                With all 15 people on board, that&apos;s under $2.50 per person.
              </p>
              <ul className="mt-6 space-y-2.5 border-t border-border pt-6">
                {team.features.slice(0, 4).map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-[14px] text-text">
                    <Check aria-hidden className="size-4 shrink-0 text-accent" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className={ctaClass("primary", "lg", "mt-7 w-full")}>
                Start free trial
              </Link>
              <p className="mt-3 text-center text-[12.5px] text-text-2">{TRIAL_NOTE}</p>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section aria-labelledby="cta-title" className="mx-auto mt-24 max-w-6xl px-4 sm:px-6 lg:mt-32">
          <div className="flex flex-col items-start gap-6 border-t border-border pt-12 md:flex-row md:items-end md:justify-between">
            <h2 id="cta-title" className="max-w-xl font-display text-[36px] leading-[1.08] tracking-tight text-text sm:text-[48px]">
              Set up your workspace before your next meeting.
            </h2>
            <div className="flex flex-wrap gap-3">
              {signedIn ? (
                <Link href={DASHBOARD_HREF} className={ctaClass("primary", "lg")}>
                  Go to your dashboard
                </Link>
              ) : (
                <>
                  <Link href="/signup" className={ctaClass("primary", "lg")}>
                    Start free trial
                  </Link>
                  <Link href="/login" className={ctaClass("ghost", "lg")}>
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter signedIn={signedIn} />
    </div>
  );
}
