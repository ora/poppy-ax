import type { Metadata } from "next";
import type { MDXContent } from "mdx/types";
import { PageIntro } from "@/components/page-intro";
import { HostedNote, LevelNav, LevelSection } from "@/components/setup-level";
import Level1 from "@/content/setup/level-1.mdx";
import Level2 from "@/content/setup/level-2.mdx";
import Level3 from "@/content/setup/level-3.mdx";
import Level4 from "@/content/setup/level-4.mdx";
import { content } from "@/lib/content";
import { setupContent } from "@/lib/setup";

const page = content.pages.setup;

export const metadata: Metadata = { title: page.title };

// One MDX file per level, in content/setup/. index.json lists them by id.
const bodies: Record<string, MDXContent> = {
  "level-1": Level1,
  "level-2": Level2,
  "level-3": Level3,
  "level-4": Level4,
};

export default function SetupPage() {
  const { levels } = setupContent;
  return (
    <div className="setup">
      <PageIntro heading={page.heading} lede={page.lede} />
      <div className="setup__layout">
        <LevelNav levels={levels} />
        <div className="setup__levels">
          {levels.map((level) => {
            const body = bodies[level.id];
            if (!body) throw new Error(`No content/setup MDX file for ${level.id}`);
            return <LevelSection key={level.id} level={level} Body={body} />;
          })}
          <HostedNote />
        </div>
      </div>
    </div>
  );
}
