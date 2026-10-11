import { describe, expect, it } from "vitest";
import { siteUrl } from "@/lib/site-url";

describe("siteUrl", () => {
  it("is https://poppy.ax with nothing set", () => {
    expect(siteUrl({}).href).toBe("https://poppy.ax/");
    expect(siteUrl({ siteUrl: "" }).href).toBe("https://poppy.ax/");
  });

  it("uses NEXT_PUBLIC_SITE_URL when set", () => {
    expect(siteUrl({ siteUrl: "http://poppy-ax.localhost:1355" }).href).toBe("http://poppy-ax.localhost:1355/");
  });

  it("uses a preview's branch address over NEXT_PUBLIC_SITE_URL, over https", () => {
    const env = { vercelEnv: "preview", branchUrl: "poppy-ax-git-fix-ora.vercel.app", siteUrl: "https://other.example" };
    expect(siteUrl(env).href).toBe("https://poppy-ax-git-fix-ora.vercel.app/");
    expect(siteUrl({ ...env, branchUrl: "https://poppy-ax-git-fix-ora.vercel.app" }).href).toBe(
      "https://poppy-ax-git-fix-ora.vercel.app/",
    );
  });

  it("never uses the branch address in production", () => {
    expect(siteUrl({ vercelEnv: "production", branchUrl: "poppy-ax-git-main-ora.vercel.app" }).href).toBe(
      "https://poppy.ax/",
    );
  });

  it("falls back when the branch address is empty or unreadable", () => {
    expect(siteUrl({ vercelEnv: "preview", branchUrl: "", siteUrl: "https://preview.example" }).href).toBe(
      "https://preview.example/",
    );
    expect(siteUrl({ vercelEnv: "preview", branchUrl: "bad host^" }).href).toBe("https://poppy.ax/");
  });
});
