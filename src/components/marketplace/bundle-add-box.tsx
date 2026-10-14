"use client";

import Link from "next/link";
import { useState } from "react";
import type { BundleFeedChoiceEntry } from "@/lib/basket-catalogue";
import type { BundleFeedChoice } from "@/lib/bundle-catalogue";
import { basketPut, useBasket } from "@/lib/basket-store";

/** The bundle's feed pick, signed in: the product page's Access box, and the shelf card's once its Add is pressed
 * (bundles S2 plan part 1 (B); card m68725). Everything it shows comes in as props from the server page: the feed
 * choices with their listing titles and availability (Fable S2 C1/C2: a client module never value-imports a
 * catalogue). NO PRICE: it shows only at the basket steps (coxwell 10-14 via marcus m68725).
 *
 * NO DEFAULT FEED: Add stays disabled until one is picked, so nobody requests a region by not looking. A choice
 * whose listing can't be requested today is shown disabled. Adding writes {kind:'bundle', key, feed}; adding again
 * with the other feed REPLACES the line (basket-store putLine: one bundle per basket). */
export function BundleAddBox({
  bundleKey,
  bundleTitle,
  choices,
}: {
  bundleKey: string;
  bundleTitle: string;
  choices: BundleFeedChoiceEntry[];
}) {
  const lines = useBasket();
  const existing = lines.find((l) => l.kind === "bundle" && l.key === bundleKey);
  const [picked, setPicked] = useState<BundleFeedChoice | null>(null);
  const titleOf = (key: BundleFeedChoice | undefined) => choices.find((c) => c.key === key)?.title;
  const changed = picked != null && picked !== existing?.feed;

  return (
    <div className="bk-bundle-box">
      <div className="bk-label">Choose your feed</div>
      <div className="bk-radio-list" role="radiogroup" aria-label="Feed">
        {choices.map((c) => (
          <label key={c.key} className={`bk-radio${c.available ? "" : " off"}${picked === c.key ? " on" : ""}`}>
            <input
              type="radio"
              name={`bundle-feed-${bundleKey}`}
              value={c.key}
              checked={picked === c.key}
              disabled={!c.available}
              onChange={() => setPicked(c.key)}
            />
            <span>
              <b>{c.title}</b>
              {!c.available && <span className="bk-radio-off">Not available right now</span>}
            </span>
          </label>
        ))}
      </div>
      <p className="fp-note">Your feed is switched on once you register a server. Everything else starts when we confirm.</p>
      {existing && (
        <div className="bk-mono bk-adds">
          In your basket: <b>{`${bundleTitle} · Feed ${titleOf(existing.feed) ?? ""}`}</b>
        </div>
      )}
      {!existing || changed ? (
        <button
          type="button"
          className="btn primary bk-addbox-btn"
          disabled={picked == null}
          onClick={() => {
            if (picked == null) return;
            basketPut({ kind: "bundle", key: bundleKey, feed: picked });
            setPicked(null);
          }}
        >
          {existing ? `Update basket — Feed ${titleOf(picked ?? undefined) ?? ""}` : "+ Add to basket"}
        </button>
      ) : null}
      {existing ? (
        <p className="fp-note">
          Already in your basket. <Link href="/marketplace/basket">View basket →</Link>
        </p>
      ) : (
        <p className="fp-note">Nothing is charged and nothing is committed. Your basket becomes one request when you send it.</p>
      )}
    </div>
  );
}

/** The shelf card's foot for an available bundle, signed in (coxwell 10-14 via marcus m68725): See more beside
 * "+ Add to basket", like every listing card. A bundle can't be basketed without its feed, so Add opens the same
 * feed pick as the product page under the foot, and the line is written from there. A bundle already in the basket
 * reads "✓ In basket", as AddToBasketButton does. */
export function BundleCardFoot({
  bundleKey,
  bundleTitle,
  choices,
  detailHref,
}: {
  bundleKey: string;
  bundleTitle: string;
  choices: BundleFeedChoiceEntry[];
  detailHref: string;
}) {
  const lines = useBasket();
  const [open, setOpen] = useState(false);
  const inBasket = lines.some((l) => l.kind === "bundle" && l.key === bundleKey);
  return (
    <>
      <div className="mkt-foot bk-foot">
        <Link href={detailHref} className="btn ghost sm mkt-cta">
          See more →
        </Link>
        {open ? null : inBasket ? (
          <Link href="/marketplace/basket" className="btn ghost sm bk-inbasket" aria-label={`${bundleTitle} is in your basket. View basket`}>
            ✓ In basket
          </Link>
        ) : (
          <button type="button" className="btn primary sm bk-add" onClick={() => setOpen(true)}>
            + Add to basket
          </button>
        )}
      </div>
      {open && <BundleAddBox bundleKey={bundleKey} bundleTitle={bundleTitle} choices={choices} />}
    </>
  );
}
