import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { SiteHeader } from "@/components/marketing/site-header";
import { getCurrentUser } from "@/lib/auth";
import { SiteFooter } from "@/components/marketing/site-footer";
import { ctaClass } from "@/components/marketing/cta";
import { PLANS, SALES_HREF, TRIAL_NOTE } from "@/components/marketing/plans";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Flat pricing per account, not per seat. Free for 1 workspace of up to 3 people, Team at $35/month for 3 workspaces, Business at $89/month for 10, and Custom for unlimited workspaces. 14-day Team trial, no card required.",
};

type Cell = boolean | string;

const COMPARISON: { group: string; rows: { label: string; values: [Cell, Cell, Cell, Cell] }[] }[] = [
  {
    group: "Workspaces",
    rows: [
      { label: "Workspaces", values: ["1", "3", "10", "Unlimited"] },
      { label: "People in each workspace", values: ["Up to 3", "Up to 15", "Up to 50", "Unlimited"] },
      { label: "File storage per workspace", values: ["100 MB", "10 GB", "50 GB", "Unlimited"] },
      { label: "All 8 tools", values: [false, true, true, true] },
    ],
  },
  {
    group: "Collaboration",
    rows: [
      { label: "Live cursors and presence", values: [true, true, true, true] },
      { label: "Instant sync of edits", values: [true, true, true, true] },
    ],
  },
  {
    group: "Security and control",
    rows: [
      { label: "Postgres row-level security", values: [true, true, true, true] },
      { label: "Owner, Admin, Member and Viewer roles", values: [true, true, true, true] },
      { label: "Audit log", values: [false, false, true, true] },
      { label: "Priority support", values: [false, false, true, true] },
    ],
  },
];

const FAQ = [
  {
    q: "What does my plan cover?",
    a: "One flat price covers your whole account: every workspace you own, and everyone in them, up to the plan’s limits. Team covers 3 workspaces of up to 15 people each for $35 a month, whether you have 9 people or 45.",
  },
  {
    q: "How does the free trial work?",
    a: "Every new account can try Team free for 14 days. We don’t ask for a card to start, so there’s nothing to cancel if you decide it’s not for you.",
  },
  {
    q: "Is there a discount for paying yearly?",
    a: "Yes. Annual billing gives you two months free: Team is $350 a year and Business is $890 a year.",
  },
  {
    q: "Can we change plans later?",
    a: "Yes. Move up as you add teams or workspaces, or back down if you shrink. Nothing is deleted when you downgrade; extra workspaces simply stay as they are.",
  },
  {
    q: "Who can see our work?",
    a: "Only members of your workspace. Access is enforced by Postgres row-level security in the database itself, and roles (Owner, Admin, Member, Viewer) control who can change what.",
  },
  {
    q: "Does the shared code editor run our code?",
    a: "No. The Code tool is for writing and reviewing code together in a shared editor. Nothing is executed.",
  },
  {
    q: "We have many teams, sites or clients. What then?",
    a: "Custom gives you unlimited workspaces, people and storage, with every tool, the audit log and priority support, at a price agreed with you. Get in touch and we’ll set it up.",
  },
];

function CellValue({ value }: { value: Cell }) {
  if (typeof value === "string") return <span className="text-text">{value}</span>;
  return value ? (
    <>
      <Check aria-hidden className="mx-auto size-4 text-accent" />
      <span className="sr-only">Included</span>
    </>
  ) : (
    <>
      <Minus aria-hidden className="mx-auto size-4 text-muted" />
      <span className="sr-only">Not included</span>
    </>
  );
}

export default async function PricingPage() {
  const signedIn = Boolean(await getCurrentUser());
  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader current="pricing" signedIn={signedIn} />

      <main>
        <section aria-labelledby="pricing-title" className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 lg:pt-20">
          <div className="max-w-2xl">
            <p className="text-[13px] font-medium tracking-wide text-accent uppercase">Pricing</p>
            <h1
              id="pricing-title"
              className="mt-4 font-display text-[44px] leading-[1.02] tracking-tight text-balance text-text sm:text-[64px]"
            >
              Pay for your team, not the headcount.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-text-2">
              One flat monthly price for your account, covering every workspace in your plan. Annual billing gets you two months free.{" "}
              {TRIAL_NOTE}
            </p>
          </div>

          {/* Plans */}
          <ul className="mt-12 grid gap-4 md:grid-cols-2 md:items-stretch xl:grid-cols-4">
            {PLANS.map((plan) => (
              <li
                key={plan.id}
                className={cn(
                  "relative flex flex-col rounded-xl border p-6 sm:p-7",
                  plan.featured ? "border-accent bg-surface shadow-lg" : "border-border bg-surface-2/50",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[17px] font-semibold text-text">{plan.name}</h2>
                  {plan.featured ? (
                    <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] font-medium text-text">
                      Most teams start here
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-text-2">{plan.blurb}</p>
                <p className="mt-6 flex items-baseline gap-2">
                  <span className="font-display text-[56px] leading-none tracking-tight text-text">
                    {plan.monthly === null ? "Custom" : `$${plan.monthly}`}
                  </span>
                  {plan.monthly === null ? null : <span className="text-[13.5px] text-text-2">per month</span>}
                </p>
                <p className="mt-2 min-h-5 text-[13px] text-text-2">
                  {plan.monthly === null
                    ? "Priced for your organisation"
                    : plan.annual
                      ? `or $${plan.annual}/year, two months free`
                      : "Free, for as long as you like"}
                </p>
                <Link
                  href={plan.id === "custom" ? SALES_HREF : "/signup"}
                  className={ctaClass(plan.featured ? "primary" : "outline", "lg", "mt-6 w-full")}
                  aria-label={`${plan.cta}: ${plan.name} plan`}
                >
                  {plan.cta}
                </Link>
                <ul className="mt-7 space-y-2.5 border-t border-border pt-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[14px] text-text">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                      {f}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[13px] text-text-2">
            Prices in USD. Paid plans start with a 14-day Team trial; no card required.
          </p>
        </section>

        {/* Comparison */}
        <section aria-labelledby="compare-title" className="mx-auto mt-24 max-w-6xl px-4 sm:px-6">
          <h2 id="compare-title" className="font-display text-[36px] leading-[1.08] tracking-tight text-text sm:text-[44px]">
            Compare plans
          </h2>
          <div className="relative mt-8 overflow-x-auto rounded-xl border border-border bg-surface" tabIndex={0} role="region" aria-labelledby="compare-title">
            <table className="w-full min-w-[680px] border-collapse text-left text-[14px]">
              <caption className="sr-only">Features included in the Free, Team, Business and Custom plans</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="w-[40%] px-5 py-4 font-medium text-text-2">
                    <span className="sr-only">Feature</span>
                  </th>
                  {PLANS.map((p) => (
                    <th key={p.id} scope="col" className="px-4 py-4 text-center">
                      <span className="block text-[15px] font-semibold text-text">{p.name}</span>
                      <span className="block text-[12.5px] font-normal text-text-2">{p.monthly === null ? "Custom price" : `$${p.monthly}/month`}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              {COMPARISON.map((section) => (
                <tbody key={section.group}>
                  <tr className="bg-surface-2">
                    <th scope="colgroup" colSpan={5} className="px-5 py-2.5 font-mono text-[11.5px] font-normal tracking-wider text-text-2 uppercase">
                      {section.group}
                    </th>
                  </tr>
                  {section.rows.map((row) => (
                    <tr key={row.label} className="border-t border-border">
                      <th scope="row" className="px-5 py-3.5 font-normal text-text">
                        {row.label}
                      </th>
                      {row.values.map((v, i) => (
                        <td key={PLANS[i]!.id} className="px-4 py-3.5 text-center">
                          <CellValue value={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </section>

        {/* FAQ */}
        <section aria-labelledby="faq-title" className="mx-auto mt-24 max-w-6xl px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)] lg:gap-16">
            <div>
              <h2 id="faq-title" className="font-display text-[36px] leading-[1.08] tracking-tight text-text sm:text-[44px]">
                Questions, answered
              </h2>
              <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-text-2">
                The short version: one price for your account, everything live, private by default.
              </p>
            </div>
            <div className="divide-y divide-border border-y border-border">
              {FAQ.map((item) => (
                <details key={item.q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[16px] font-medium text-text [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden
                      className="relative size-4 shrink-0 text-muted before:absolute before:top-1/2 before:left-0 before:h-px before:w-4 before:bg-current after:absolute after:top-0 after:left-1/2 after:h-4 after:w-px after:bg-current after:transition-transform after:duration-150 group-open:after:scale-y-0"
                    />
                  </summary>
                  <p className="max-w-2xl pb-5 text-[14.5px] leading-relaxed text-text-2">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="pricing-cta" className="mx-auto mt-24 max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-start gap-6 border-t border-border pt-12 md:flex-row md:items-end md:justify-between">
            <h2 id="pricing-cta" className="max-w-xl font-display text-[36px] leading-[1.08] tracking-tight text-text sm:text-[48px]">
              Try Team free for 14 days.
            </h2>
            <Link href="/signup" className={ctaClass("primary", "lg")}>
              Start free trial
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter signedIn={signedIn} />
    </div>
  );
}
