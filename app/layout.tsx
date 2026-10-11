import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Besley } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { content } from "@/lib/content";
import "./globals.css";

// Display: Besley, a Clarendon revival with sturdy slabbed serifs.
const display = Besley({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// Body: Atkinson Hyperlegible, drawn by the Braille Institute for readers
// with low vision. The original family has fallback metrics in next/font,
// so the swap from the fallback face causes no layout shift.
const body = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute URLs for canonical links and preview images. Previews set
  // NEXT_PUBLIC_SITE_URL to their own address. `||`, not `??`, so an empty
  // value copied from .env.example falls back too.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://poppy.ax"),
  title: { default: content.metadata.title, template: `%s | ${content.siteName}` },
  description: content.metadata.description,
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
      </body>
    </html>
  );
}
