import Link from "next/link";
import { content } from "@/lib/content";

/** The site name, with its dot drawn as a small poppy. */
export function Wordmark() {
  const [name, ...rest] = content.siteName.split(".");
  return (
    <Link href="/" className="wordmark" aria-label={content.homeLinkLabel}>
      <span aria-hidden="true">
        {name}
        {rest.length > 0 && <span className="wordmark__dot">.</span>}
        {rest.join(".")}
      </span>
    </Link>
  );
}
