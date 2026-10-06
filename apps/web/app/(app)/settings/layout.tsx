"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { s } from "@/lib/style";
import { A } from "@/components/ui";
import { Page, PageTitle } from "@/components/kit";

const TABS: [string, string][] = [["General", "/settings"], ["API Keys", "/settings/keys"], ["Network", "/settings/network"]];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <Page>
      <PageTitle title="Settings" />
      <div style={s("display:flex;gap:24px;border-bottom:1px solid #1D221F")}>
        {TABS.map(([label, href]) => (
          <A key={href} href={href} css={`height:40px;display:flex;align-items:center;border-bottom:1px solid ${path === href ? "#E8ECE9" : "transparent"};margin-bottom:-1px;color:${path === href ? "#E8ECE9" : "#7C847F"};font-size:13.5px`} hover="color:#E8ECE9">{label}</A>
        ))}
      </div>
      <div style={s("max-width:880px")}>{children}</div>
    </Page>
  );
}
