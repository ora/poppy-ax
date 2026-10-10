"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { content } from "@/lib/content";

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label={content.nav.label} className="main-nav">
      <ul>
        {content.nav.items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
