import { PageIntro } from "@/components/page-intro";
import { content } from "@/lib/content";

export default function HomePage() {
  const { heading, lede } = content.pages.home;
  return <PageIntro heading={heading} lede={lede} display />;
}
