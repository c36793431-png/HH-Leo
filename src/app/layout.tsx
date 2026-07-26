import type { Metadata } from "next";
import { Inter, Saira_Condensed, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { Footer } from "@/components/footer";
import "./globals.css";
import "./portal.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const sairaCondensed = Saira_Condensed({
  variable: "--font-saira",
  weight: ["600", "700", "800"],
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Horizon HFT Portal",
  description: "Client portal for Horizon HFT — licenses, downloads, and updates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${sairaCondensed.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#05060a] text-zinc-100">
        <Providers>{children}</Providers>
        <Footer />
      </body>
    </html>
  );
}
