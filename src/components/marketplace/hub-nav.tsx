import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { MAIN_SITE_URL } from "@/lib/main-site";
import { BasketNavButton } from "@/components/marketplace/basket-controls";

/**
 * The main site's top nav, on the signed-out marketplace (coxwell via marcus, m58986): the main
 * site's header links here, so its menu stays on screen instead of disappearing. The links, their
 * order, icons, accents and the burger's sheet are copied from the live horizonhft.com header
 * (header.top, 2026-10-02); the main site's pages are absolute links to it, and Marketplace is this
 * page, marked current. It is sticky, which the main site's header is not.
 *
 * The class names carry an hn- prefix because portal.css already styles .portal-shell .nav and
 * .brand for the sidebar. The burger is a <details>, so the shell stays server-only.
 */

const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

const SECTIONS = [
  {
    key: "software",
    label: "Software",
    path: "/software",
    note: "/software",
    icon: svg(
      <>
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
        <path d="m7 9.75 3 2.5-3 2.5" />
        <path d="M12.5 15H17" />
      </>,
    ),
  },
  {
    key: "strategies",
    label: "Strategies",
    path: "/strategies",
    note: "/strategies",
    icon: svg(
      <>
        <path d="M12 21.5V14" />
        <path d="M12 14 4.5 6.5" />
        <path d="M12 14l7.5-7.5" />
        <path d="M3.75 12V5.75H10" />
        <path d="M14 5.75h6.25V12" />
      </>,
    ),
  },
  {
    key: "feeds",
    label: "Feeds",
    path: "/feeds",
    note: "/feeds",
    icon: svg(
      <>
        <circle cx="12" cy="12" r="1.9" />
        <path d="M8.46 8.46a5 5 0 0 0 0 7.08" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.08" />
        <path d="M5.64 5.64a9 9 0 0 0 0 12.72" />
        <path d="M18.36 5.64a9 9 0 0 1 0 12.72" />
      </>,
    ),
  },
  {
    key: "partners",
    label: "Partners",
    path: "/partners",
    note: "/partners",
    icon: svg(
      <g transform="rotate(-45 12 12)">
        <rect x="1" y="8.25" width="13" height="7.5" rx="3.75" />
        <rect x="10" y="8.25" width="13" height="7.5" rx="3.75" />
      </g>,
    ),
  },
  {
    key: "consulting",
    label: "Consulting",
    path: "/consulting",
    note: "coming soon",
    icon: svg(
      <>
        <path d="M5 3.5h8a2 2 0 0 1 2 2V10a2 2 0 0 1-2 2H8.5l-3 2.5V12H5a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z" />
        <path d="M15 8.5h4a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2h-.5v2.5l-3-2.5H11a2 2 0 0 1-2-2v-3" />
      </>,
    ),
  },
  {
    key: "education",
    label: "Education",
    path: "/education",
    note: "/education",
    icon: svg(
      <>
        <path d="M2 9.5 12 5l10 4.5L12 14z" />
        <path d="M6 11.3V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.7" />
        <path d="M22 9.5V15" />
      </>,
    ),
  },
] as const;

const MARKETPLACE_ICON = svg(
  <>
    <path d="M5.2 8h13.6l-.9 11.2a1.8 1.8 0 0 1-1.8 1.6H7.9a1.8 1.8 0 0 1-1.8-1.6z" />
    <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
  </>,
);

const CHANGELOG_HREF = `${MAIN_SITE_URL}/software#releases`;

export function HubNav({ signInHref }: { signInHref: string }) {
  return (
    <header className="hubnav">
      <div className="hn-wrap">
        <a className="hn-brand" href={MAIN_SITE_URL} aria-label="Horizon HFT home">
          <Image src="/brand/horizon-logo-hub-128.png" alt="" width={34} height={34} priority />
          <span className="hn-wm">
            HORIZON<small>HFT</small>
          </span>
        </a>
        <nav className="hn-nav" aria-label="Horizon HFT">
          {SECTIONS.map((s) => (
            <a key={s.key} href={`${MAIN_SITE_URL}${s.path}`} className={`hn-sec hn-sec-${s.key}`}>
              {s.icon}
              {s.label}
            </a>
          ))}
          <span className="hn-sep" />
          <Link href="/marketplace" className="hn-sec hn-sec-marketplace on" aria-current="page">
            {MARKETPLACE_ICON}
            Marketplace
          </Link>
          <a href={CHANGELOG_HREF}>Changelog</a>
          <BasketNavButton className="hn-basket" />
          <Link href={signInHref} className="hn-login">
            Sign in
          </Link>
        </nav>
        <div className="hn-right">
          {/* The request basket, signed out too: a visitor builds it here and signs in to send.
              One copy in the full nav, one here for the narrow header; CSS shows one at a time. */}
          <BasketNavButton className="hn-basket" />
          <Link href={signInHref} className="hn-login">
            Sign in
          </Link>
          <details className="hn-burger">
            <summary className="hn-menu">Menu</summary>
            <div className="hn-sheet">
              <div className="hn-grp">Horizon sites</div>
              {SECTIONS.map((s) => (
                <a key={s.key} className={`hn-it hn-sec hn-sec-${s.key}`} href={`${MAIN_SITE_URL}${s.path}`}>
                  <span className="hn-it-l">
                    {s.icon}
                    {s.label}
                  </span>
                  <small>{s.note}</small>
                </a>
              ))}
              <div className="hn-row2">
                <Link href="/marketplace" className="hn-sec hn-sec-marketplace on" aria-current="page">
                  {MARKETPLACE_ICON}
                  Marketplace
                </Link>
                <a href={CHANGELOG_HREF}>Changelog</a>
              </div>
              <Link className="hn-btn" href={signInHref}>
                Sign in <span>→</span>
              </Link>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
