import type { Metadata } from "next";
import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";
import { PageIntro } from "@/components/page-intro";
import { textOf } from "@/components/setup-level";
import Learn from "@/content/learn.mdx";
import { content } from "@/lib/content";
import { slug } from "@/lib/setup";
import "./learn.css";

const page = content.pages.learn;

export const metadata: Metadata = {
  title: page.title,
  description: page.description,
  alternates: { canonical: "/learn" },
};

// Every heading gets an id from its text, so a section can be linked: /learn#where-it-stands.
function heading(Tag: "h2" | "h3") {
  return function Heading({ children }: { children?: ReactNode }) {
    return <Tag id={slug(textOf(children))}>{children}</Tag>;
  };
}

const components: MDXComponents = { h2: heading("h2"), h3: heading("h3") };

export default function LearnPage() {
  return (
    <div className="learn">
      <PageIntro heading={page.heading} lede={page.lede} />
      <div className="prose learn__body">
        <Learn components={components} />
      </div>
    </div>
  );
}
