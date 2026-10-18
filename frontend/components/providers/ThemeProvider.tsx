"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { getSession, type UserRole } from "@/app/lib/auth/session";

function getAccountThemeKey(pathname: string): string {
  const role: UserRole = pathname.startsWith("/admin")
    ? "ADMIN"
    : pathname.startsWith("/vendor")
      ? "VENDOR"
      : "USER";

  const email = getSession(role)?.user.email
    ?.trim()
    .toLowerCase();

  const accountId = email
    ? encodeURIComponent(email)
    : "guest";

  return `campusvita-theme-${role.toLowerCase()}-${accountId}`;
}

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [storageKey, setStorageKey] = useState(
    "campusvita-theme-initial"
  );

  useEffect(() => {
    setStorageKey(getAccountThemeKey(pathname));
  }, [pathname]);

  return (
    <NextThemesProvider
      key={storageKey}
      storageKey={storageKey}
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
