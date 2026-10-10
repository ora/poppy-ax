import type { Metadata } from "next";
import { PageIntro } from "@/components/page-intro";
import { content } from "@/lib/content";

const page = content.pages.setup;

export const metadata: Metadata = { title: page.title };

export default function SetupPage() {
  return <PageIntro heading={page.heading} lede={page.lede} />;
}
