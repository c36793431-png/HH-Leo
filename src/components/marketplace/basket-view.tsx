"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ShoppingBasket } from "lucide-react";
import type { BasketEntry, BasketLine } from "@/lib/basket-catalogue";
import {
  basketClear,
  basketKeepOnly,
  basketPut,
  basketRemove,
  setBasketStep,
  useBasket,
  type BasketStep,
  type StoredBasketLine,
} from "@/lib/basket-store";
import { submitBasketAction, type SubmitReach } from "@/app/marketplace/basket/actions";

/**
 * /marketplace/basket (Iris sheets 3-5 + r2 2-4; rulings marcus m59146). A REQUEST basket, not a
 * checkout: no price field, no total, nothing charged. Three steps on one page: Basket, Review,
 * Sent. Rules carried from the sheets:
 * - Every line reads "Priced by agreement · talk to us"; no total and no subtotal while a line is
 *   unpriced, which today is every line.
 * - Notes inform and never block: a feed line says whether a registered server is on file, a
 *   strategy line that it comes with a licence. The basket writes no envelope, so no server check
 *   runs at submit.
 * - The trial is ONE basket-level choice in the summary box (m59146/m59154), off by default, amber
 *   when ticked, shown only to an eligible signed-in account; on Review it is a read-only row.
 * - We confirm by email only (coxwell 13:54Z via marcus m59928): Review shows the account's email
 *   read-only and asks for nothing; Telegram is not mentioned on any client step.
 * - Sent uses the m59928 line word for word plus the support contact, no reply time, and the count
 *   goes back to 0.
 * - Phone (r2 sheet 4, marcus m59367 d4): on the basket step the summary card keeps only the trial
 *   box, and a bar sticky at the bottom carries the next step.
 */

export interface BasketAccount {
  email: string | null;
  trialEligible: boolean;
  feedReady: boolean;
}

type Step = BasketStep;

const PRICE = (
  <div className="bk-price">
    Priced by agreement
    <small>talk to us</small>
  </div>
);

function Thumb({ entry }: { entry: BasketEntry }) {
  if (!entry.image) return <div className="bk-thumb bk-thumb-plate" aria-hidden="true" />;
  return (
    <div className="bk-thumb">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={entry.image} alt="" />
      {entry.mark && entry.mark !== "plate-desktop" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="bk-thumb-mark" src={`/marketplace/flags/${entry.mark}.svg`} alt="" />
      )}
    </div>
  );
}

const KIND_TAG: Record<BasketEntry["kind"], string> = { software: "Software", strategy: "Strategy", feed: "Feed" };

function serversText(n: number) {
  return `${n} server${n === 1 ? "" : "s"}`;
}

export function BasketView({
  catalogue,
  account,
  signInHref,
}: {
  catalogue: BasketEntry[];
  /** null = signed out. */
  account: BasketAccount | null;
  signInHref: string;
}) {
  const stored = useBasket();
  const [step, setStep] = useState<Step>("basket");
  const [wantTrial, setWantTrial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ reference: string; lines: BasketLine[]; hasTrial: boolean; reach: SubmitReach } | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(catalogue.map((e) => [`${e.kind}:${e.key}`, e])), [catalogue]);
  const lines = stored
    .map((l) => ({ stored: l, entry: byId.get(`${l.kind}:${l.key}`) }))
    .filter((l): l is { stored: StoredBasketLine; entry: BasketEntry } => l.entry != null);

  // A stored line the catalogue no longer offers (a product taken off sale since it was added) is
  // dropped from the store, so the count and the send agree with what this page shows.
  useEffect(() => {
    basketKeepOnly((l) => byId.has(`${l.kind}:${l.key}`));
  }, [stored, byId]);

  // The portal topbar titles the page by step ("Request sent").
  useEffect(() => {
    setBasketStep(step);
  }, [step]);
  useEffect(() => () => setBasketStep("basket"), []);

  const counts = {
    software: lines.filter((l) => l.entry.kind === "software").length,
    strategy: lines.filter((l) => l.entry.kind === "strategy").length,
    feed: lines.filter((l) => l.entry.kind === "feed").length,
    servers: lines.reduce((n, l) => n + (l.entry.kind === "feed" ? (l.stored.servers ?? 1) : 0), 0),
  };
  const trialOffered = account?.trialEligible === true;
  const trialOn = trialOffered && wantTrial;

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await submitBasketAction({
        lines: lines.map((l) => l.stored),
        wantTrial: trialOn,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSent({ reference: res.reference, lines: res.lines, hasTrial: res.hasTrial, reach: res.reach });
      basketClear();
      setStep("sent");
      window.scrollTo({ top: 0 });
    });
  }

  const steps = (
    <ol className="bk-steps" aria-label="Steps">
      {(["basket", "review", "sent"] as Step[]).map((s, i) => (
        <li key={s} className={s === step ? "on" : undefined} aria-current={s === step ? "step" : undefined}>
          <span>{i + 1}</span> {s === "basket" ? "Basket" : s === "review" ? "Review" : "Sent"}
        </li>
      ))}
    </ol>
  );

  // ---- 3 · SENT ----
  if (step === "sent" && sent) {
    return (
      <div className="bk-page">
        {steps}
        <div className="bk-sent-grid">
          <div className="card bk-sent">
            <div className="bk-sent-mark" aria-hidden="true">✓</div>
            <div>
              <h2>Request sent</h2>
              {/* What happens next, said truthfully for this account (marcus m61849 part 3). */}
              <p>
                <b>What happens next:</b>{" "}we review your request within 24 hours. You&apos;ll see the answer under My
                requests and on your dashboard, and we&apos;ll message you by Telegram or email. Nothing has been charged and
                nothing has started yet.
              </p>
              {sent.reach.needsBotStart && (
                <div className="bk-notify" role="note">
                  <b>Turn on notifications</b>
                  <p>
                    We can&apos;t message you yet: there&apos;s no email on this account and the Horizon bot hasn&apos;t
                    been started. Open the bot and press Start so we can tell you when your request is approved.
                  </p>
                  {sent.reach.botStartUrl ? (
                    <a className="btn primary" href={sent.reach.botStartUrl} target="_blank" rel="noopener noreferrer">
                      Open the Horizon bot →
                    </a>
                  ) : (
                    <p>
                      Or message <a href="https://t.me/Coxwell2" target="_blank" rel="noopener noreferrer">@Coxwell2</a> on Telegram.
                    </p>
                  )}
                </div>
              )}
              {account?.email && (
                <div className="bk-chips">
                  <span className="bk-chip">{account.email}</span>
                </div>
              )}
              <div className="bk-ref">
                Reference <b>{sent.reference}</b>
              </div>
              <p className="bk-contact">
                Questions? <a href="mailto:support@horizonhft.com">support@horizonhft.com</a>
              </p>
            </div>
          </div>
          <div className="card bk-list">
            <div className="bk-list-head">
              What you asked for <small>a copy, read-only</small>
            </div>
            {sent.lines.map((l) => (
              <div key={`${l.kind}:${l.key}`} className="bk-row">
                <div>
                  <b>{l.name}</b>
                  <div className="bk-sub">
                    {KIND_TAG[l.kind]}
                    {l.kind === "feed" && ` · ${serversText(l.servers ?? 1)}`}
                    {l.kind === "strategy" && " · Included with a Horizon licence"}
                  </div>
                </div>
                <span className="bk-row-price">Priced by agreement</span>
              </div>
            ))}
            {sent.hasTrial && (
              <div className="bk-row bk-row-trial">
                <div>
                  <b>Start with a 30-day trial</b>
                  <div className="bk-sub">Requested · set up when we confirm</div>
                </div>
                <span className="bk-row-price">Trial</span>
              </div>
            )}
          </div>
          <div className="bk-sent-actions">
            <Link href="/marketplace/requests" className="btn primary">
              My requests →
            </Link>
            <Link href="/marketplace" className="btn ghost">
              Back to the marketplace
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---- EMPTY ----
  if (lines.length === 0) {
    return (
      <div className="bk-page">
        {steps}
        <div className="card bk-empty">
          <ShoppingBasket size={34} strokeWidth={1.5} aria-hidden="true" />
          <h2>Your basket is empty</h2>
          <p>Add software, strategies or feeds from the marketplace, then send them to us as one request.</p>
          <Link href="/marketplace" className="btn primary sm">
            Browse the marketplace →
          </Link>
        </div>
      </div>
    );
  }

  const summaryRows = (
    <>
      <div className="bk-sum-row">
        <span>Software</span>
        <b>{counts.software}</b>
      </div>
      <div className="bk-sum-row">
        <span>Strategies</span>
        <b>{counts.strategy}</b>
      </div>
      <div className="bk-sum-row">
        <span>Feeds</span>
        <b>
          {counts.feed}
          {counts.feed > 0 && ` · ${serversText(counts.servers)}`}
        </b>
      </div>
    </>
  );

  // ---- 2 · REVIEW ----
  if (step === "review") {
    return (
      <div className="bk-page">
        {steps}
        <div className="bk-grid">
          <div className="card bk-list">
            <div className="bk-list-head">
              Review your request{" "}
              <small>
                {lines.length} {lines.length === 1 ? "line" : "lines"} · one request
              </small>
            </div>
            {lines.map(({ stored: s, entry }) => (
              <div key={`${entry.kind}:${entry.key}`} className="bk-row">
                <div>
                  <b>{entry.name}</b>
                  <div className="bk-sub">
                    {KIND_TAG[entry.kind]}
                    {entry.kind !== "strategy" && entry.chips.length > 0 && ` · ${entry.chips.join(" · ")}`}
                    {entry.kind === "feed" && ` · ${serversText(s.servers ?? 1)}`}
                    {entry.kind === "strategy" && " · Included with a Horizon licence"}
                  </div>
                </div>
                <span className="bk-row-price">Priced by agreement</span>
              </div>
            ))}
            <button type="button" className="bk-link" onClick={() => setStep("basket")}>
              ← Edit basket
            </button>
            <div className="bk-reply">
              <div className="bk-label">We confirm by email</div>
              <div className="bk-input bk-input-ro">{account?.email ?? "The email on your account"}</div>
              <p className="fp-note">Read-only, from your account.</p>
            </div>
          </div>
          <aside className="card bk-summary">
            <h2>Send request</h2>
            {summaryRows}
            {trialOn && (
              <div className="bk-trial on bk-trial-ro">
                <b>✓ Start with a 30-day trial</b>
                <p>A 30-day trial licence, set up when we confirm.</p>
              </div>
            )}
            {error && (
              <p className="bk-error" role="alert">
                {error}
              </p>
            )}
            <button type="button" className="btn primary bk-cta" disabled={pending} onClick={send}>
              {pending ? "Sending…" : "Send request →"}
            </button>
            <p className="fp-note">
              <b>Nothing is charged and nothing starts yet.</b> We read your request and confirm by email.
            </p>
          </aside>
        </div>
      </div>
    );
  }

  // ---- 1 · BASKET ----
  // The summary card's button on desktop, the sticky bar's on a phone.
  const nextStep = account ? (
    <button type="button" className="btn primary bk-cta" onClick={() => setStep("review")}>
      Review request →
    </button>
  ) : (
    <Link href={signInHref} className="btn primary bk-cta">
      Sign in to send →
    </Link>
  );
  return (
    <div className="bk-page">
      {steps}
      <div className="bk-grid">
        <div className="card bk-list">
          <div className="bk-list-head">
            Basket{" "}
            <small>
              {lines.length} {lines.length === 1 ? "line" : "lines"} · one request
            </small>
          </div>
          {lines.map(({ stored: s, entry }) => {
            const servers = s.servers ?? 1;
            return (
              <div key={`${entry.kind}:${entry.key}`} className="bk-line">
                <Thumb entry={entry} />
                <div className="bk-line-body">
                  <div className="bk-line-top">
                    <div>
                      <div className="bk-line-name">
                        {entry.detailHref ? <Link href={entry.detailHref}>{entry.name}</Link> : entry.name}
                        <span className="bk-tag">{KIND_TAG[entry.kind]}</span>
                      </div>
                      {entry.chips.length > 0 && (
                        <div className="bk-chips">
                          {entry.chips.map((c) => (
                            <span key={c} className="bk-chip">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {PRICE}
                  </div>

                  {entry.kind === "strategy" && (
                    <div className="bk-note">
                      <b>Included with a Horizon licence.</b>{" "}
                      If you don&apos;t have one yet, we&apos;ll sort that out with you.
                    </div>
                  )}
                  {entry.kind === "feed" &&
                    (account?.feedReady ? (
                      <div className="bk-note bk-note-ok">
                        <b>Server registered.</b> Nothing else needed for this line.
                      </div>
                    ) : (
                      <div className="bk-note">
                        <b>Needs a registered server</b> before this feed can be switched on. You can still send the request
                        now. <Link href="/account/servers">Register a server →</Link>
                      </div>
                    ))}

                  <div className="bk-line-actions">
                    {entry.kind === "feed" ? (
                      <div className="bk-stepper" role="group" aria-label={`Servers for ${entry.name}`}>
                        <button
                          type="button"
                          aria-label="One fewer server"
                          disabled={servers <= 1}
                          onClick={() => basketPut({ ...s, servers: servers - 1 })}
                        >
                          −
                        </button>
                        <span>
                          <b>{servers}</b> server{servers === 1 ? "" : "s"}
                        </span>
                        <button
                          type="button"
                          aria-label="One more server"
                          disabled={servers >= 20}
                          onClick={() => basketPut({ ...s, servers: servers + 1 })}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <span className="bk-sub">{entry.kind === "software" ? "One licence, for you" : "One strategy"}</span>
                    )}
                    {/* The tier picker is the feed's own product page (marcus m59367 d1): no picker here. */}
                    {entry.kind === "feed" && entry.detailHref && (
                      <Link href={entry.detailHref} className="bk-link bk-link-strong">
                        Change tier
                      </Link>
                    )}
                    <button type="button" className="bk-link" onClick={() => basketRemove(entry.kind, entry.key)}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <aside className={`card bk-summary${trialOffered ? "" : " bk-summary-notrial"}`}>
          <div className="bk-desk">
            <h2>Your request</h2>
            {summaryRows}
            <div className="bk-nototal">
              <b>No total.</b> Every line is priced by agreement.
            </div>
          </div>
          {trialOffered && (
            <label className={`bk-trial${wantTrial ? " on" : ""}`}>
              <input type="checkbox" checked={wantTrial} onChange={(e) => setWantTrial(e.target.checked)} />
              <span>
                <b>Start with a 30-day trial</b>
                <span className="bk-trial-text">
                  We set up a 30-day trial licence when we confirm your request. Nothing to pay. Your first request only.
                </span>
              </span>
            </label>
          )}
          <div className="bk-desk">
            {nextStep}
            <p className="fp-note">
              {account ? "Next you check one summary and send it. " : "Your basket stays here while you sign in. "}
              <b>Nothing is charged and nothing starts yet.</b>
            </p>
            <Link href="/marketplace" className="bk-link bk-keep">
              ← Keep browsing
            </Link>
          </div>
        </aside>
      </div>
      <div className="bk-bar">
        <div className="bk-bar-total">
          <span>Total</span>
          <b>Set when terms are agreed</b>
        </div>
        {nextStep}
      </div>
    </div>
  );
}
