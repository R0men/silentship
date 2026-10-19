"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A link to a section of the home page (`/#id`). next/link does nothing when the URL, hash included, is
 * already the target, so a second click after scrolling away would not scroll back. On the home page this
 * is a plain anchor, which the browser scrolls to on every click (smooth, `scroll-margin-top` and reduced
 * motion come from the CSS); elsewhere it navigates to the home page.
 */
export default function SectionLink({ id, children, ...props }) {
  const pathname = usePathname();
  if (pathname === "/") {
    return (
      <a href={`#${id}`} {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link href={`/#${id}`} {...props}>
      {children}
    </Link>
  );
}
