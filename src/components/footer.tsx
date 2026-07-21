import { getPortalConfig } from "@/lib/portal-config";

export async function Footer() {
  const config = await getPortalConfig();

  return (
    <footer className="mt-auto border-t border-zinc-800 bg-[#05060a] px-4 py-6 sm:px-10">
      <div className="flex flex-col items-center justify-between gap-3 text-xs text-zinc-500 sm:flex-row">
        <p>&copy; {new Date().getFullYear()} Horizon HFT. All rights reserved.</p>
        <div className="flex gap-4">
          <a
            href={config.telegramChannelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-cyan-400 hover:underline"
          >
            Channel
          </a>
          <a
            href={config.communityGroupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-cyan-400 hover:underline"
          >
            Community
          </a>
        </div>
      </div>
    </footer>
  );
}
