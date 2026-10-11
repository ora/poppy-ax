import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// Everything may be crawled. The check route only starts work on a POST, and
// result pages that should stay out of search say so in their own metadata.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl({
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
    branchUrl: process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}
