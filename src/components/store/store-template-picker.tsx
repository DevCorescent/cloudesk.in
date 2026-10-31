"use client";

// Store templates in the dashboard: pick one, name the shop, and land in the
// store setup with the design already chosen. Modern templates show their
// real storefront (hover to scroll the whole page); classics show their photo.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { photoUrl } from "@/lib/site/media";
import { STORE_TEMPLATES_SHOWN, type StoreTemplate } from "@/lib/store/templates";

type Kind = "glass" | "signature" | "classic";
const kindOf = (t: StoreTemplate): Kind => (t.look?.glass ? "glass" : t.look ? "signature" : "classic");
const KIND_LABEL: Record<Kind, string> = { glass: "Glass", signature: "Signature", classic: "Classic" };
const FILTERS: [Kind | "all", string][] = [
  ["all", "All"],
  ["glass", "Glass collection"],
  ["signature", "Signature"],
  ["classic", "Classic"],
];

/** A full-page capture of the real storefront exists for every modern template. */
const pageShot = (t: StoreTemplate) => (t.look ? `/marketing/store/templates/${t.id}.jpg` : null);

export function StorePreview({ t, height }: { t: StoreTemplate; height: number }) {
  const shot = pageShot(t);
  return (
    <div className="tpl-window relative overflow-hidden bg-surface-2" style={{ height }}>
      {shot ? (
        <Image src={shot} alt={`The ${t.name} storefront, full page`} width={1200} height={7400} sizes="(min-width: 1280px) 30vw, (min-width: 640px) 50vw, 100vw" className="tpl-page absolute inset-x-0 top-0 h-auto w-full" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- remote template photo
        <img src={photoUrl(t.image, 900, [4, 3])} alt="" loading="lazy" className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
      )}
      <span className="absolute top-3 left-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white backdrop-blur">{KIND_LABEL[kindOf(t)]}</span>
      {shot && <span className="absolute top-3 right-3 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-medium text-black/70 backdrop-blur transition-opacity group-hover:opacity-0">Hover to scroll ↓</span>}
    </div>
  );
}

export function StoreTemplatePicker() {
  const { org } = useSession();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<StoreTemplate | null>(null);
  const [name, setName] = useState("");

  const match = (t: StoreTemplate) => !q.trim() || `${t.name} ${t.category} ${t.description}`.toLowerCase().includes(q.trim().toLowerCase());
  const shown = STORE_TEMPLATES_SHOWN.filter((t) => (filter === "all" || kindOf(t) === filter) && match(t));

  const create = useMutation({
    mutationFn: () => api<{ project: { id: string } }>(`/api/v1/orgs/${org.id}/projects`, { method: "POST", body: { templateId: "store", name: name.trim() || chosen!.storeName } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["projects", org.id] });
      const qs = new URLSearchParams({ template: chosen!.id, name: name.trim() || chosen!.storeName, fresh: "1" });
      router.push(`/projects/${r.project.id}/store?${qs}`);
    },
    onError: (e) => toast({ tone: "error", title: "Could not create the store", description: errorMessage(e) }),
  });

  const open = (t: StoreTemplate) => {
    setChosen(t);
    setName(t.storeName);
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative w-full lg:max-w-xs">
          <span className="sr-only">Search store templates</span>
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or category" className="!rounded-full pl-10" />
        </label>
        <div role="radiogroup" aria-label="Collection" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:pb-0">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={filter === id}
              onClick={() => setFilter(id)}
              className={clsx("h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-[background,color,box-shadow] duration-[var(--dur)]", filter === id ? "bg-fg text-bg shadow-sm" : "glass-card text-muted hover:text-fg")}
            >
              {label} <span className="ml-0.5 tabular-nums opacity-60">{STORE_TEMPLATES_SHOWN.filter((t) => id === "all" || kindOf(t) === id).length}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-muted">No store templates match “{q}”.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => (
            <article key={t.id} className="tpl-card group glass-card flex flex-col overflow-hidden rounded-[var(--radius-xl)] transition-[transform,box-shadow] duration-300 ease-[var(--ease)] hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]">
              <button onClick={() => open(t)} className="block text-left" aria-label={`Preview ${t.name}`}>
                <StorePreview t={t} height={260} />
              </button>
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t.name}</h2>
                  <Badge>{t.category}</Badge>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t.description}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-5">
                  <span className="inline-flex items-center gap-2 text-[12px] text-muted">
                    <span className="size-3.5 rounded-full ring-1 ring-black/10 dark:ring-white/15" style={{ background: t.accent }} aria-hidden />
                    {t.products.length} sample products
                  </span>
                  <Button variant="primary" onClick={() => open(t)}>
                    Use template
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog
        open={!!chosen}
        onClose={() => setChosen(null)}
        size="2xl"
        title={`New store from “${chosen?.name}”`}
        description="We'll create the store with this design and sample products. Next you'll add where you sell from — everything stays editable."
        footer={
          <>
            <Button onClick={() => setChosen(null)}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              Continue <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          </>
        }
      >
        {chosen && (
          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <div className="tpl-card group self-start overflow-hidden rounded-[var(--radius-lg)] border border-border shadow-[var(--shadow-md)]">
              <StorePreview t={chosen} height={440} />
            </div>
            <div className="min-w-0 space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate();
                }}
              >
                <Field label="Store name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />}</Field>
              </form>
              <dl className="grid gap-2 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Category</dt>
                  <dd>{chosen.category}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Collections</dt>
                  <dd className="text-right">{chosen.collections.map((c) => c.title).join(", ")}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Sample products</dt>
                  <dd>{chosen.products.length}</dd>
                </div>
              </dl>
              <p className="rounded-[var(--radius-md)] bg-surface-2 px-3 py-2.5 text-[12px] text-muted">Sample products can&apos;t be bought until you replace them with your own — so nothing goes live by accident.</p>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
