"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingBasket } from "lucide-react";
import type { BasketLineKind } from "@/lib/basket-catalogue";
import { basketPut, useBasket } from "@/lib/basket-store";

/** Basket page route. One spelling for every control that links there. */
const BASKET_HREF = "/marketplace/basket";
const MAX_SERVERS = 20;

/** The Basket button with its count (Iris sheet 1). The count is LINES, not units: a feed is
 * counted in servers and the terminal has no unit, so a sum would mean nothing (Iris m59141). */
export function BasketNavButton({ className = "" }: { className?: string }) {
  const count = useBasket().length;
  return (
    <Link href={BASKET_HREF} className={`bk-navbtn ${className}`} aria-label={`Basket, ${count} ${count === 1 ? "line" : "lines"}`}>
      <ShoppingBasket size={16} strokeWidth={1.9} aria-hidden="true" />
      <span>Basket</span>
      <span className={`bk-count${count > 0 ? " on" : ""}`}>{count}</span>
    </Link>
  );
}

/** A shelf card's footer control: "+ Add to basket", then "✓ In basket" (a link to the basket).
 * A feed is added with one server; the count is changed on the product page or the basket. */
export function AddToBasketButton({ kind, keyName, name }: { kind: BasketLineKind; keyName: string; name: string }) {
  const lines = useBasket();
  const [added, setAdded] = useState(false);
  const inBasket = lines.some((l) => l.kind === kind && l.key === keyName);
  if (inBasket) {
    return (
      <Link href={BASKET_HREF} className="btn ghost sm bk-inbasket" aria-label={`${name} is in your basket. View basket`}>
        ✓ In basket
        {added && (
          <span className="bk-added" role="status">
            Added
          </span>
        )}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="btn primary sm bk-add"
      onClick={() => {
        basketPut(kind === "feed" ? { kind, key: keyName, servers: 1 } : { kind, key: keyName });
        setAdded(true);
      }}
    >
      + Add to basket
    </button>
  );
}

/** /marketplace?strategy=<slug> (marcus m59280): the main site's strategy cards land here with
 * that strategy added and its card in view. The page resolves the slug, so an unknown one never
 * mounts this. basketPut replaces a same-product line, so a reload doesn't add it twice. */
export function StrategyPreselect({ keyName }: { keyName: string }) {
  useEffect(() => {
    basketPut({ kind: "strategy", key: keyName });
    (document.getElementById(`strategy-${keyName}`) ?? document.getElementById("strategies"))?.scrollIntoView({
      block: "center",
    });
  }, [keyName]);
  return null;
}

/**
 * The product page's basket box (Iris sheet 2): a server stepper for a feed, the "Adds:" line
 * showing exactly the basket line, and Add / Update. It sits UNDER the Access box, which keeps
 * the listing's own request control: the per-feed Request access stays the only tracked path
 * (marcus m59146), so the basket is offered beside it, never in its place.
 */
export function BasketAddBox({
  kind,
  keyName,
  name,
  chips,
}: {
  kind: BasketLineKind;
  keyName: string;
  name: string;
  chips: string[];
}) {
  const lines = useBasket();
  const existing = lines.find((l) => l.kind === kind && l.key === keyName);
  const [picked, setPicked] = useState<number | null>(null);
  const servers = picked ?? existing?.servers ?? 1;
  const isFeed = kind === "feed";
  const serversText = `${servers} server${servers === 1 ? "" : "s"}`;
  // The title already names region and tier ("London · Base"), so the line adds only its count.
  const adds = [name, isFeed ? serversText : chips[0]?.toLowerCase()].filter(Boolean).join(" · ");
  const changed = existing && isFeed && servers !== (existing.servers ?? 1);

  return (
    <div className="card bk-addbox">
      <div className="mkd-plate-title">Basket</div>
      <p className="bk-addbox-lead">Priced by agreement · talk to us</p>
      {isFeed && (
        <>
          <div className="bk-label">How many servers?</div>
          <div className="bk-stepper" role="group" aria-label="Servers">
            <button type="button" aria-label="One fewer server" disabled={servers <= 1} onClick={() => setPicked(Math.max(1, servers - 1))}>
              −
            </button>
            <span>
              <b>{servers}</b> server{servers === 1 ? "" : "s"}
            </span>
            <button type="button" aria-label="One more server" disabled={servers >= MAX_SERVERS} onClick={() => setPicked(Math.min(MAX_SERVERS, servers + 1))}>
              +
            </button>
          </div>
          <div className="bk-mono">
            = {servers} licence{servers === 1 ? "" : "s"} · {serversText} · one IP each
          </div>
        </>
      )}
      <div className="bk-mono bk-adds">
        {existing ? "In your basket: " : "Adds: "}
        <b>{adds}</b>
      </div>
      {!existing || changed ? (
        <button
          type="button"
          className="btn primary bk-addbox-btn"
          onClick={() => {
            basketPut(isFeed ? { kind, key: keyName, servers } : { kind, key: keyName });
            setPicked(null);
          }}
        >
          {existing ? `Update basket — ${serversText}` : "+ Add to basket"}
        </button>
      ) : null}
      {existing ? (
        <p className="fp-note">
          Already in your basket. <Link href={BASKET_HREF}>View basket →</Link>
        </p>
      ) : (
        <p className="fp-note">
          Nothing is charged and nothing is committed. Your basket becomes one request when you send it; terms are
          agreed before access is granted.
        </p>
      )}
      {!isFeed && kind === "software" && (
        <p className="fp-note">No quantity here: one licence, for you.</p>
      )}
    </div>
  );
}
