/** The production address. */
export const PRODUCTION_URL = "https://poppy.ax";

export interface SiteUrlEnv {
  /** NEXT_PUBLIC_VERCEL_ENV: "production", "preview" or "development" on Vercel. */
  vercelEnv?: string;
  /** NEXT_PUBLIC_VERCEL_BRANCH_URL: the preview's branch host, without a scheme. */
  branchUrl?: string;
  /** NEXT_PUBLIC_SITE_URL: an address set by hand. */
  siteUrl?: string;
}

function parse(value: string | undefined): URL | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    return new URL(text);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/**
 * The site's own address, for canonical links and preview images. On a
 * Vercel preview it is the branch address (https), so a preview's links point
 * at the preview. Otherwise NEXT_PUBLIC_SITE_URL when it is set (an empty
 * value counts as unset), else https://poppy.ax.
 */
export function siteUrl(env: SiteUrlEnv): URL {
  if (env.vercelEnv === "preview") {
    const branch = env.branchUrl?.trim().replace(/^https?:\/\//, "");
    const url = branch ? parse(`https://${branch}`) : null;
    if (url) return url;
  }
  return parse(env.siteUrl) ?? new URL(PRODUCTION_URL);
}
