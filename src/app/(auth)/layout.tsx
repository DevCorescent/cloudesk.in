import Link from "next/link";
import { Logo } from "@/components/brand";
import { AuthShowcase, AuthStrip } from "@/components/auth-showcase";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pastel relative grid min-h-dvh grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
      {/* Phones: the colour light sits softly behind the form. */}
      <div className="p-aurora opacity-60 lg:hidden" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="relative flex min-h-dvh flex-col">
        <header className="px-6 py-6 sm:px-10">
          <Logo />
        </header>
        <main className="flex flex-1 items-center justify-center px-5 pb-10 lg:pb-16">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>
        {/* Phones and tablets: what's inside, under the form. */}
        <div className="pb-8 lg:hidden">
          <AuthStrip />
        </div>
        <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-6 pb-6 text-[12px] text-subtle sm:px-10 lg:justify-start">
          <span>Secure sign-in · Your data stays yours</span>
          <nav aria-label="Legal" className="flex gap-x-3">
            <Link href="/terms" className="hover:text-fg">Terms</Link>
            <Link href="/privacy" className="hover:text-fg">Privacy</Link>
            <Link href="/security" className="hover:text-fg">Security</Link>
          </nav>
        </footer>
      </div>
      <div className="hidden p-4 lg:block">
        <AuthShowcase />
      </div>
    </div>
  );
}
