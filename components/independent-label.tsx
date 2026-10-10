import { content } from "@/lib/content";

export function IndependentLabel({ className }: { className?: string }) {
  const { before, linkText, href, after } = content.independentLabel;
  return (
    <p className={className}>
      {before}
      <a href={href}>{linkText}</a>
      {after}
    </p>
  );
}
