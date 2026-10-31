import { SettingsNav } from "./nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="mb-4 text-[22px] font-semibold tracking-[-0.02em] lg:mb-6">Settings</h1>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <SettingsNav />
        {/* min-w-0 lets wide tables and long text scroll inside the page instead of stretching it. */}
        <div className="settings-body min-w-0">{children}</div>
      </div>
    </div>
  );
}
