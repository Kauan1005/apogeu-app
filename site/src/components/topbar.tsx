import { Suspense, type ReactNode } from "react";
import { MonthNav, PrivacyToggle, SignOut } from "./shell";
import { LogoMark } from "./brand";
import { SearchButton } from "./quick-search";

export function Topbar({ title, month, children }: { title: string; month?: { label: string; prev: string; next: string }; children?: ReactNode }) {
  return (
    <header className="top">
      <span className="top-logo"><LogoMark size={22} /></span>
      <h1>{title}</h1>
      <span className="sp" />
      {children}
      {month && (
        <Suspense>
          <MonthNav {...month} />
        </Suspense>
      )}
      <SearchButton />
      <PrivacyToggle />
      <SignOut />
    </header>
  );
}
