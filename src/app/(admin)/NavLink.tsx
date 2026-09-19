"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({
  href,
  children,
  badge,
}: {
  href: string;
  children: React.ReactNode;
  badge?: number;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className="relative shrink-0 pb-2.5 pt-2.5 text-[13.5px] font-semibold whitespace-nowrap border-b-2 transition-colors"
      style={{
        color: active ? "var(--brand-dark)" : "var(--ink-muted)",
        borderColor: active ? "var(--brand-dark)" : "transparent",
      }}
    >
      {children}
      {!!badge && (
        <span
          className="absolute -top-0.5 -start-2.5 text-white text-[9px] rounded-full min-w-[15px] h-[15px] px-0.5 flex items-center justify-center font-bold"
          style={{ background: "var(--red-700)" }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
