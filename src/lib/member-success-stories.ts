// The old main site's "Member Success Stories" carousel, back at coxwell's ask (relayed by marcus,
// m59186): every word is the old component's (src/components/success-carousel.tsx on v0
// deployment dpl_8K2KL7MSE, transcribed by foc16 in m58605), in its order. The figures and claims
// are coxwell's to publish, and he has (marcus m59209). Trimmed per m59209: card 4 is dropped
// (the same certificate file as card 1) and card 5's image is foc16's redacted copy. None of the
// old "04 — Verified Performance" section text comes with it (m59274).
// Images: foc16's shared set (m59267), under /public/marketplace/member-stories/. `alt` is ours,
// a plain description of the picture; the old component had none.
// Cards added since lead the set, each on coxwell's own OK (id 10+, see each card).
export type MemberSuccessStory = {
  id: number; // the old component's card number, 1-9; 10+ are cards added since
  image: { src: string; width: number; height: number; alt: string };
  label?: string; // the kicker; MEMBER_SUCCESS_LABEL when absent
  title: string;
  subtitle: string;
  description: string;
  tags: string[];
  date: string;
};

export const MEMBER_SUCCESS_LABEL = "MEMBER SUCCESS";
export const MEMBER_SUCCESS_HEADING = "Member Success Stories";
export const MEMBER_SUCCESS_FOOTNOTE =
  "Past performance does not guarantee future results. Trading involves substantial risk of loss.";

const img = (n: string, width: number, height: number, alt: string) => ({
  src: `/marketplace/member-stories/card${n}.png`,
  width,
  height,
  alt,
});

export const MEMBER_SUCCESS_STORIES: MemberSuccessStory[] = [
  {
    // coxwell OK'd it (Horizon Clients #156, 2026-10-05 19:27Z) and marcus put it first (m61095).
    // Image is Iris's r3 card (m61087), text her m61079 draft as approved. No profit or "powered by" wording.
    id: 10,
    image: {
      src: "/marketplace/member-stories/client-feedback-aylrn_1440x960.png",
      width: 1440,
      height: 960,
      alt: "Horizon card headed \"Straight from a client's phone.\": two phone screenshots one client sent, their avatar blurred. On the left, a broker trade history from 30 Sep 2026 above a chat; on the right, a history from 5 Oct 2026. Losing trades shown in red",
    },
    label: "CLIENT FEEDBACK",
    title: "Client trade logs, two days",
    subtitle: "XAUUSD, 0.01 lots · 30 Sep and 5 Oct 2026",
    description:
      "One client's broker history from two days, as they sent it, with the losing trades left in. Asked which system it was, they answered in their own words.",
    tags: ["ClientFeedback", "XAUUSD", "0.01lots"],
    date: "October 2026",
  },
  {
    id: 1,
    image: img("01", 902, 683, "Topstep Certified Funded Trader certificate dated April 2, 2026, surname blurred"),
    title: "Topstep Funded Trader",
    subtitle: "Trading Combine Passed",
    description:
      "Showed up, stayed disciplined, and proved consistent risk management. Officially a certified Topstep Funded Trader.",
    tags: ["Topstep", "Funded", "Combine"],
    date: "April 2026",
  },
  {
    id: 2,
    image: img("02", 1280, 835, "Apex Trader Funding account certificate for a 25k Rithmic EOD Trail Account, dated April 7, 2026, surname blurred"),
    title: "Apex Challenge Passed",
    subtitle: "25k Rithmic EOD Trail Account",
    description:
      "3 funded accounts running simultaneously, powered exclusively by Horizon HFT on Rithmic connection. This is what consistent execution looks like.",
    tags: ["Apex", "Rithmic", "25k Account"],
    date: "April 2026",
  },
  {
    id: 3,
    image: img("03", 512, 604, 'Message reading "Your request to withdraw $5,080.00 has been sent!"'),
    title: "$5,080 Withdrawal",
    subtitle: "Payout Confirmed",
    description:
      "Withdrawal request processed and confirmed. Real profits, real payouts. Powered by Horizon HFT automated execution.",
    tags: ["Withdrawal", "Verified", "Payout"],
    date: "2026",
  },
  {
    id: 5,
    image: img("05", 1280, 591, "Horizon HFT v1.6 window next to a price chart and a trade list, settings and account fields blurred"),
    title: "Live Trading Session",
    subtitle: "Horizon HFT v1.6 in Action",
    description:
      "Real-time trade execution with profit tracking. Multiple winning trades logged with precise entry and exit timing.",
    tags: ["Live", "v1.6", "Execution"],
    date: "March 2026",
  },
  {
    id: 6,
    image: img("06", 1264, 1280, "Wallet screen showing an available amount of $4,300.00 and a history row: Deposit wallet, $4,300, succeeded, 03/12/2026"),
    title: "$4,300 Withdrawal",
    subtitle: "Deposit Wallet - Succeeded",
    description:
      "Successful withdrawal of $4,300 processed and deposited. Verified transaction history showing real trading profits.",
    tags: ["Withdrawal", "$4,300", "Verified"],
    date: "March 2026",
  },
  {
    id: 7,
    image: img("07", 1280, 910, "Trade list from 12 March 2026 with a profit per trade, a few of them negative, partly covered by the Horizon HFT logo"),
    title: "Consistent Trade Log",
    subtitle: "Multiple Winning Trades",
    description:
      "Detailed trade history showing consistent small wins accumulating into significant profits. Precision execution at scale.",
    tags: ["Trades", "Consistent", "Profits"],
    date: "March 2026",
  },
  {
    id: 8,
    image: img("08", 1205, 601, 'Graphic headed "Apex Trader Funding, Challenge Passed": an account certificate beside a table with gross realized PnL of $911.00, $1,520.00 and $972.00 highlighted'),
    title: "Apex Challenge Passed",
    subtitle: "25k Rithmic EOD Trail Account",
    description:
      "Apex Trader Funding challenge passed with verified profits. Account certificate and trading results showing $911, $1,520, and $972 realized PnL. Powered by Horizon HFT on Rithmic connection.",
    tags: ["ApexFunded", "Rithmic", "25k Account"],
    date: "April 2026",
  },
  {
    id: 9,
    image: img("09", 1080, 1261, "Two Wise payout requests, $3,700 on May 5, 2026 and $4,100 on May 14, 2026, each marked submitted, funds removed and funding approved, under a $7,800 member payout banner"),
    title: "$7,800 Member Payout",
    subtitle: "Dual Withdrawal via Wise",
    description:
      "One of our community members received significant payouts powered by Horizon HFT. May 5 $3,700 | May 14 $4,100 via Wise. Funding Approved, Funds Removed. Consistent execution across multiple cycles.",
    tags: ["Payout", "$7,800", "Wise"],
    date: "May 2026",
  },
];
