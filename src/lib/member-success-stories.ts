// The old main site's "Member Success Stories" carousel, back at coxwell's ask (relayed by marcus,
// m59186): every word is the old component's (src/components/success-carousel.tsx on v0
// deployment dpl_8K2KL7MSE, transcribed by foc16 in m58605), in its order. The figures and claims
// are coxwell's to publish, and he has (marcus m59209). Trimmed per m59209: card 4 is dropped
// (the same certificate file as card 1) and card 5's image is foc16's redacted copy. None of the
// old "04 — Verified Performance" section text comes with it (m59274).
// Images: foc16's shared set (m59267), under /public/marketplace/member-stories/. `alt` is ours,
// a plain description of the picture; the old component had none.
export type MemberSuccessStory = {
  id: number; // the old component's card number, 1-9
  image: { src: string; width: number; height: number; alt: string };
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
    id: 1,
    image: img("01", 902, 683, "Topstep Certified Funded Trader certificate, April 2026"),
    title: "Topstep Funded Trader",
    subtitle: "Trading Combine Passed",
    description:
      "Showed up, stayed disciplined, and proved consistent risk management. Officially a certified Topstep Funded Trader.",
    tags: ["Topstep", "Funded", "Combine"],
    date: "April 2026",
  },
  {
    id: 2,
    image: img("02", 1280, 835, "Apex Trader Funding account certificate, 25k Rithmic EOD Trail Account"),
    title: "Apex Challenge Passed",
    subtitle: "25k Rithmic EOD Trail Account",
    description:
      "3 funded accounts running simultaneously, powered exclusively by Horizon HFT on Rithmic connection. This is what consistent execution looks like.",
    tags: ["Apex", "Rithmic", "25k Account"],
    date: "April 2026",
  },
  {
    id: 3,
    image: img("03", 512, 604, "Withdrawal confirmation for $5,080.00"),
    title: "$5,080 Withdrawal",
    subtitle: "Payout Confirmed",
    description:
      "Withdrawal request processed and confirmed. Real profits, real payouts. Powered by Horizon HFT automated execution.",
    tags: ["Withdrawal", "Verified", "Payout"],
    date: "2026",
  },
  {
    id: 5,
    image: img("05", 1280, 591, "Horizon HFT v1.6 beside a chart and its trade history, account figures blurred"),
    title: "Live Trading Session",
    subtitle: "Horizon HFT v1.6 in Action",
    description:
      "Real-time trade execution with profit tracking. Multiple winning trades logged with precise entry and exit timing.",
    tags: ["Live", "v1.6", "Execution"],
    date: "March 2026",
  },
  {
    id: 6,
    image: img("06", 1264, 1280, "Wallet screen showing a $4,300 withdrawal, succeeded"),
    title: "$4,300 Withdrawal",
    subtitle: "Deposit Wallet - Succeeded",
    description:
      "Successful withdrawal of $4,300 processed and deposited. Verified transaction history showing real trading profits.",
    tags: ["Withdrawal", "$4,300", "Verified"],
    date: "March 2026",
  },
  {
    id: 7,
    image: img("07", 1280, 910, "Trade history with per-trade profit"),
    title: "Consistent Trade Log",
    subtitle: "Multiple Winning Trades",
    description:
      "Detailed trade history showing consistent small wins accumulating into significant profits. Precision execution at scale.",
    tags: ["Trades", "Consistent", "Profits"],
    date: "March 2026",
  },
  {
    id: 8,
    image: img("08", 1205, 601, "Apex Trader Funding challenge passed: certificate and realized PnL"),
    title: "Apex Challenge Passed",
    subtitle: "25k Rithmic EOD Trail Account",
    description:
      "Apex Trader Funding challenge passed with verified profits. Account certificate and trading results showing $911, $1,520, and $972 realized PnL. Powered by Horizon HFT on Rithmic connection.",
    tags: ["ApexFunded", "Rithmic", "25k Account"],
    date: "April 2026",
  },
  {
    id: 9,
    image: img("09", 1080, 1261, "Two payout requests via Wise, $7,800 net"),
    title: "$7,800 Member Payout",
    subtitle: "Dual Withdrawal via Wise",
    description:
      "One of our community members received significant payouts powered by Horizon HFT. May 5 $3,700 | May 14 $4,100 via Wise. Funding Approved, Funds Removed. Consistent execution across multiple cycles.",
    tags: ["Payout", "$7,800", "Wise"],
    date: "May 2026",
  },
];
