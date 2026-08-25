"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createProviderApplicationAction } from "@/app/feed/providers/apply/actions";
import { emitToast } from "@/lib/toast-bus";

function generateReferenceId(): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `FP-${year}-${rand}`;
}

const PROTOCOL_OPTIONS = ["FIX 4.4", "FIX 4.2", "WebSocket", "REST"];
const REGION_OPTIONS = ["LD4 · London", "NY4 · New York", "TY3 · Tokyo"];

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const maskedUser = user.length <= 2 ? user : `${user[0]}${"*".repeat(user.length - 2)}${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
}

/** Whole applywrap body (head-lead + rail + form <-> success), so the page-level
 * "which section is showing" toggle lives in one client component -- mirrors
 * partner-apply-form.tsx's useTransition/local-state pattern, mirroring
 * createPartnerApplicationAction's shape but for provider_applications. Reference id is a
 * client-visible label only (not a real DB sequence -- see createProviderApplication, which
 * doesn't generate one), good enough for the applicant to quote in a follow-up email. */
export function ProviderApplyForm() {
  const [submitted, setSubmitted] = useState<{ email: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [referenceId] = useState(generateReferenceId);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createProviderApplicationAction(null, formData);
      if (result.ok) {
        setSubmitted({ email: ((formData.get("email") as string) ?? "").trim() });
      } else {
        setError(result.error);
        emitToast(result.error, "error");
      }
    });
  }

  if (submitted) {
    return (
      <div className="fap-success">
        <div className="seal">
          <svg viewBox="0 0 24 24">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <path d="M22 4 12 14.01l-3-3" />
          </svg>
        </div>
        <h2>Application received</h2>
        <div className="em">
          Ref&nbsp;·&nbsp;{referenceId} &nbsp;→&nbsp; {maskEmail(submitted.email)}
        </div>
        <p>
          Thanks — we&apos;ve got your feed provider application and sent a confirmation to your inbox.{" "}
          <b>Our team will be in touch</b> once we&apos;ve reviewed it, usually within two business days.
        </p>
        <div className="next">
          <div className="nh">What happens next</div>
          <ul className="fap-steps">
            <li>
              <span className="sn">1</span>
              <div className="st">
                <b>Review</b>
                <span>We assess fit, coverage, and data quality.</span>
              </div>
            </li>
            <li>
              <span className="sn">2</span>
              <div className="st">
                <b>Endpoint verification</b>
                <span>We connect and confirm your feed before anything ships.</span>
              </div>
            </li>
            <li>
              <span className="sn">3</span>
              <div className="st">
                <b>Activation invite</b>
                <span>Approved? Your invite lands in your inbox and your workspace opens.</span>
              </div>
            </li>
          </ul>
        </div>
        <div className="cta">
          <Link className="fap-btn amber" href="/">
            Back to feed network <span className="ar">→</span>
          </Link>
          <a className="fap-btn ghost" href="/login">
            Provider login
          </a>
        </div>
      </div>
    );
  }

  return (
    <form className="fap-formcard" action={handleSubmit}>
      {/* 1. COMPANY & CONTACT */}
      <div className="fap-fieldset">
        <div className="fap-legend">
          <span className="num">1</span> Company &amp; contact
        </div>
        <div className="fap-field">
          <label>
            Company / feed provider name <span className="req">*</span>
          </label>
          <input className="fap-inp" name="name" type="text" placeholder="e.g. Sigma Markets" required disabled={isPending} />
        </div>
        <div className="fap-field">
          <label>
            Primary contact email <span className="req">*</span>
          </label>
          <input className="fap-inp" name="email" type="email" placeholder="ops@sigma-md.io" required disabled={isPending} />
          <div className="fap-hint">
            If your application is approved, your activation invite is sent here — you&apos;ll set your own password
            and finish onboarding from that link.
          </div>
        </div>
        <div className="fap-field">
          <label>Contact display name</label>
          <input className="fap-inp" name="contactName" type="text" placeholder="e.g. Sigma Markets Desk" disabled={isPending} />
        </div>
        <div className="fap-field-row">
          <div className="fap-field">
            <label>Country / region</label>
            <select className="fap-sel" name="country" disabled={isPending} defaultValue="United Kingdom">
              <option>United Kingdom</option>
              <option>United States</option>
              <option>Singapore</option>
              <option>Germany</option>
              <option>United Arab Emirates</option>
              <option>Other</option>
            </select>
          </div>
          <div className="fap-field">
            <label>Timezone</label>
            <select className="fap-sel" name="timezone" disabled={isPending} defaultValue="Europe/London (UTC+0)">
              <option>Europe/London (UTC+0)</option>
              <option>America/New_York (UTC−5)</option>
              <option>Asia/Singapore (UTC+8)</option>
              <option>Europe/Berlin (UTC+1)</option>
            </select>
          </div>
        </div>
        <div className="fap-field">
          <label>Website / feed documentation URL</label>
          <input className="fap-inp mono" name="websiteUrl" type="text" placeholder="https://sigma-md.io/data" disabled={isPending} />
          <div className="fap-hint">Optional — helps our team review your feed faster.</div>
        </div>
      </div>

      {/* 2. YOUR FEED — optional now */}
      <div className="fap-fieldset">
        <div className="fap-legend">
          <span className="num">2</span> Your feed <span className="opt">Optional now</span>
        </div>
        <p className="fap-set-sub">
          Share what you can — we verify the endpoint before go-live, so blanks are fine. These map straight to the
          connection our team confirms at registration.
        </p>
        <div className="fap-field">
          <label>Feed protocol(s)</label>
          <div className="fap-chips" role="group" aria-label="Feed protocols">
            {PROTOCOL_OPTIONS.map((opt) => (
              <label className="chip" key={opt}>
                <input type="checkbox" name="protocol" value={opt} disabled={isPending} />
                <span className="bx">✓</span>
                {opt}
              </label>
            ))}
          </div>
        </div>
        <div className="fap-field">
          <label>Host endpoint</label>
          <input className="fap-inp mono" name="host" type="text" placeholder="fix.sigma-md.io" disabled={isPending} />
        </div>
        <div className="fap-field-row">
          <div className="fap-field">
            <label>Port</label>
            <input className="fap-inp mono" name="port" type="text" placeholder="9443" disabled={isPending} />
          </div>
          <div className="fap-field">
            <label>CompID / stream id</label>
            <input className="fap-inp mono" name="compid" type="text" placeholder="SIGMA_MD" disabled={isPending} />
          </div>
        </div>
        <div className="fap-field">
          <label>Regions you can serve</label>
          <div className="fap-chips" role="group" aria-label="Regions">
            {REGION_OPTIONS.map((opt) => (
              <label className="chip" key={opt}>
                <input type="checkbox" name="regions" value={opt} disabled={isPending} />
                <span className="bx">✓</span>
                {opt}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 3. WHAT YOU'LL OFFER — no price fields */}
      <div className="fap-fieldset">
        <div className="fap-legend">
          <span className="num">3</span> What you&apos;ll offer
        </div>
        <p className="fap-set-sub">
          Describe the coverage and tiers you&apos;d publish. Pricing and the exact tier bindings
          (<code>provider_tiers</code>) are set with our team after review — no need to quote a price here.
        </p>
        <div className="fap-field">
          <label>Asset classes / instruments covered</label>
          <input
            className="fap-inp"
            name="coverage"
            type="text"
            placeholder="e.g. FX majors + metals, US equities L2, crypto perps"
            disabled={isPending}
          />
        </div>
        <div className="fap-field">
          <label>Tiers you plan to offer</label>
          <textarea
            className="fap-txta"
            name="tiersOffered"
            placeholder="e.g. Standard consolidated feed (global); Alpha ultra-low-latency L2 (us-east); Premium full-depth L3 (us-east + eu-west)."
            disabled={isPending}
          />
          <div className="fap-hint">Free-form — one line per tier is perfect. We&apos;ll turn these into priced tier bindings together at registration.</div>
        </div>
        <div className="fap-rev-note">
          <svg viewBox="0 0 24 24">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <span>
            Providers earn a <b>50% revenue share</b> on every subscriber, cleared each billing cycle. Your split is
            confirmed in writing before any tier goes live.
          </span>
        </div>
      </div>

      {/* 4. ANYTHING ELSE + CONSENT */}
      <div className="fap-fieldset">
        <div className="fap-legend">
          <span className="num">4</span> Anything else
        </div>
        <div className="fap-field">
          <label>Notes for our team</label>
          <textarea
            className="fap-txta"
            name="notes"
            placeholder="Volumes, existing venues, how soon you'd like to launch, or anything that helps us review."
            disabled={isPending}
          />
        </div>
        <div className="fap-field" style={{ marginTop: 6 }}>
          <label className="fap-consent">
            <input type="checkbox" required disabled={isPending} />
            <span>
              I confirm I&apos;m authorized to publish this feed and agree to Horizon&apos;s{" "}
              <a href="/provider-terms">provider terms</a> and <a href="/privacy">privacy policy</a>.
            </span>
          </label>
        </div>
      </div>

      {error && <p className="fap-form-error">{error}</p>}

      {/* SUBMIT */}
      <div className="fap-submitbar">
        <div className="note">
          <svg viewBox="0 0 24 24">
            <path d="M20 6 9 17l-5-5" />
          </svg>{" "}
          Takes ~3 minutes · you&apos;ll get an email confirmation right away.
        </div>
        <button className="fap-btn amber" type="submit" disabled={isPending}>
          {isPending ? "Submitting…" : "Submit application"} <span className="ar">→</span>
        </button>
      </div>
    </form>
  );
}
