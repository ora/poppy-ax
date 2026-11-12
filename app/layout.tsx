import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Besley, Inter } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { content } from "@/lib/content";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

// Display: Besley, a Clarendon revival with sturdy slabbed serifs.
const display = Besley({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// Body: Inter, a screen face with open shapes, plain zeros and tabular
// figures for the counts on a result. next/font ships fallback metrics for
// it, so the swap from the fallback face causes no layout shift.
const body = Inter({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute URLs for canonical links and preview images: a Vercel preview's
  // own branch address, else NEXT_PUBLIC_SITE_URL, else https://poppy.ax.
  // Each variable is named in full so Next can inline it at build time.
  metadataBase: siteUrl({
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
    branchUrl: process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  }),
  title: { default: content.metadata.title, template: `%s | ${content.siteName}` },
  description: content.metadata.description,
  keywords: content.metadata.keywords,
  // No title or description here: link previews fall back to each page's own
  // <title> and description. The preview image is app/opengraph-image.tsx.
  openGraph: { siteName: content.siteName, type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          {content.skipLink}
        </a>
        <div className="page">
          <SiteHeader />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
        </div>
        <Analytics />
      </body>
    </html>
  );
}
