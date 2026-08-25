"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createProviderApplicationAction } from "@/app/feed/providers/apply/actions";
import { emitToast } from "@/lib/toast-bus";

const PROTOCOL_SUGGESTIONS = ["FIX 4.4", "FIX 4.2", "ITCH", "OUCH", "Binary", "WebSocket"];
const REGION_SUGGESTIONS = ["LD4", "NY4", "FR2", "TY3", "CH1", "AISG"];

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const maskedUser = user.length <= 2 ? user : `${user[0]}${"*".repeat(user.length - 2)}${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
}

/** Whole applywrap body (head-lead + rail + form <-> success), so the page-level
 * "which section is showing" toggle lives in one client component -- mirrors
 * partner-apply-form.tsx's useTransition/local-state pattern, mirroring
 * createPartnerApplicationAction's shape but for provider_applications. Reference id comes back
 * from the server action (persisted on the row, 0067) so the confirmation screen and the admin
 * queue always agree on the same string -- it used to be generated client-side independently
 * of the DB row, which is exactly the mismatch marcus's report caught. */
export function ProviderApplyForm() {
  const [submitted, setSubmitted] = useState<{ email: string; referenceId: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [protocol, setProtocol] = useState("");
  const [regions, setRegions] = useState("");

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createProviderApplicationAction(null, formData);
      if (result.ok) {
        setSubmitted({ email: ((formData.get("email") as string) ?? "").trim(), referenceId: result.referenceId });
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
          Ref&nbsp;·&nbsp;{submitted.referenceId} &nbsp;→&nbsp; {maskEmail(submitted.email)}
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
          <label>Feed protocol</label>
          <input
            className="fap-inp mono"
            name="protocol"
            type="text"
            maxLength={24}
            placeholder="e.g. FIX 4.4 — or your own"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            disabled={isPending}
          />
          <div className="fap-chips" role="group" aria-label="Protocol suggestions">
            {PROTOCOL_SUGGESTIONS.map((opt) => (
              <button
                type="button"
                className="chip"
                key={opt}
                onClick={() => setProtocol(opt)}
                disabled={isPending}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="fap-hint">State the protocol your feed speaks. We show this to reviewers exactly as you enter it.</div>
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
          <label>Region / datacentre</label>
          <input
            className="fap-inp mono"
            name="regions"
            type="text"
            maxLength={32}
            placeholder="e.g. LD4 · NY4"
            value={regions}
            onChange={(e) => setRegions(e.target.value)}
            disabled={isPending}
          />
          <div className="fap-chips" role="group" aria-label="Region suggestions">
            {REGION_SUGGESTIONS.map((opt) => (
              <button
                type="button"
                className="chip"
                key={opt}
                onClick={() =>
                  setRegions((prev) => {
                    const existing = prev
                      .split(/[,·]+/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (existing.includes(opt)) return prev;
                    return existing.length ? `${existing.join(", ")}, ${opt}` : opt;
                  })
                }
                disabled={isPending}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="fap-hint">Where your feed is served from. Add more than one, separated by a comma.</div>
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
