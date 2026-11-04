"use client";

// Finance: invoicing and financials for the whole workspace, with no website
// or store needed. A workspace can keep several sets of books (one per
// business); each has everything invoicing offers inside a project.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BookOpen, FileText, Landmark, Plus, ReceiptText, ScrollText, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InvoicingShell } from "@/components/invoicing/invoicing-app";
import { bookApiBase } from "@/components/invoicing/shared";
import { useSession } from "@/components/shell/session-context";
import { Dialog, useToast } from "@/components/ui/overlays";
import { Button, ErrorState, Input, Skeleton, cx } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/client/api";
import { formatMoney } from "@/lib/store/money";

type Book = { id: string; name: string; createdAt: string; currency: string; documents: number; outstanding: number };
const TINTS = ["lavender", "mint", "peach", "sky", "butter", "rose"] as const;

export function FinanceApp({ path }: { path: string[] }) {
  const { org } = useSession();
  const [bookId, ...rest] = path;
  const books = useQuery({ queryKey: ["finance-books", org.id], queryFn: () => api<{ books: Book[] }>(`/api/v1/finance/books?orgId=${org.id}`), retry: false });
  if (bookId && /^[0-9a-f-]{36}$/i.test(bookId)) {
    const many = (books.data?.books.length ?? 0) > 1;
    return (
      <InvoicingShell
        key={bookId}
        ownerId={bookId}
        base={`/finance/${bookId}`}
        apiBase={bookApiBase(bookId)}
        path={rest}
        back={
          <Link href="/finance?all=1" className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
            <ArrowLeft className="size-3.5" /> {many ? "All books" : "Finance"}
          </Link>
        }
      />
    );
  }
  return <FinanceHome books={books} />;
}

function FinanceHome({ books }: { books: ReturnType<typeof useQuery<{ books: Book[] }>> }) {
  const { org, user } = useSession();
  const router = useRouter();
  const showAll = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("all");
  const list = books.data?.books;
  // One set of books: go straight to it.
  useEffect(() => {
    if (list?.length === 1 && !showAll) router.replace(`/finance/${list[0].id}`);
  }, [list, showAll, router]);

  if (books.isError)
    return (books.error as { status?: number }).status === 403 ? (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <Landmark className="mx-auto size-6 text-muted" />
        <h1 className="mt-3 text-lg font-semibold">Finance isn&apos;t available to your role</h1>
        <p className="mt-1 text-[13px] text-muted">Ask a workspace owner or admin for the Billing, Editor or Admin role.</p>
      </div>
    ) : (
      <ErrorState message={errorMessage(books.error)} onRetry={() => books.refetch()} />
    );
  if (!list || (list.length === 1 && !showAll))
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <Skeleton className="h-48 rounded-[28px]" />
      </div>
    );
  if (!list.length) return <FirstBooks orgName={org.name} userName={user.name} />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <section className="fin-hero mb-6 rounded-[28px] p-6 sm:p-8">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">Finance</p>
        <h1 className="mt-1 text-[clamp(1.8rem,4vw,2.6rem)] font-semibold tracking-[-0.03em]">Your books</h1>
        <p className="mt-1 max-w-xl text-[14px] text-muted">Invoices, quotations, payments and reports — one set of books per business. Separate from any website or store.</p>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((b, i) => (
          <Link key={b.id} href={`/finance/${b.id}`} className={cx("tint-card lx-card group grid gap-4 rounded-[22px] p-5", `tint-${TINTS[i % TINTS.length]}`)}>
            <span className="tint-chip grid size-10 place-items-center rounded-[13px]"><BookOpen className="size-4" /></span>
            <span>
              <span className="block text-[16px] font-semibold">{b.name}</span>
              <span className="block text-[12px] text-muted">{b.documents} document{b.documents === 1 ? "" : "s"}</span>
            </span>
            <span className="flex items-end justify-between">
              <span>
                <span className="block text-[11px] text-muted">Owed to you</span>
                <span className="block text-[20px] font-semibold tabular-nums">{formatMoney(b.outstanding, b.currency)}</span>
              </span>
              <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
        <NewBookCard />
      </div>
    </div>
  );
}

function useCreateBook() {
  const { org } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (name: string) => api<{ book: Book }>("/api/v1/finance/books", { method: "POST", body: { orgId: org.id, name } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["finance-books", org.id] });
      router.push(`/finance/${r.book.id}`);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn't create the books", description: errorMessage(e) }),
  });
}

function NewBookCard() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateBook();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="grid min-h-48 place-items-center rounded-[22px] border border-dashed border-border-strong p-5 text-center text-[13px] text-muted transition-colors hover:bg-surface-2/60 hover:text-fg">
        <span className="grid justify-items-center gap-2"><Plus className="size-5" /> New set of books<span className="text-[12px]">For another business or brand</span></span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="New set of books" description="Each has its own clients, numbering, templates and reports." footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate(name)}>Create</Button></>}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate(name)} placeholder="Business name" aria-label="Business name" />
      </Dialog>
    </>
  );
}

/** First visit: a short, friendly start. */
function FirstBooks({ orgName, userName }: { orgName: string; userName: string }) {
  const [name, setName] = useState(orgName.replace(/'s workspace$/i, "").trim() || "");
  const create = useCreateBook();
  const features: [React.ReactNode, string, string, (typeof TINTS)[number]][] = [
    [<FileText key="a" className="size-4" />, "GST invoices & quotations", "Clients accept quotes online; convert them in one click", "sky"],
    [<Wallet key="b" className="size-4" />, "Payments & reminders", "UPI pay-by-QR, part payments, automatic reminders", "mint"],
    [<ReceiptText key="c" className="size-4" />, "Your own format", "8 designs, or upload the invoice you use today", "peach"],
    [<ScrollText key="d" className="size-4" />, "Reports & GST", "What you're owed, ageing, tax summary, CSV exports", "lavender"],
  ];
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <section className="fin-hero rounded-[32px] p-7 sm:p-10">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">Finance</p>
        <h1 className="mt-2 max-w-2xl text-[clamp(2rem,5vw,3.2rem)] leading-[1.03] font-semibold tracking-[-0.04em] text-balance">Invoicing and your financials, in one calm place.</h1>
        <p className="mt-3 max-w-xl text-[15px] text-muted">No website or store needed. Bill clients, get paid and see where your money stands{userName ? `, ${userName.split(" ")[0]}` : ""}.</p>
        <form
          className="mt-7 flex max-w-lg flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(name);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your business name" aria-label="Your business name" className="!h-11 min-w-56 flex-1 bg-surface-solid/80 text-[15px]" />
          <Button type="submit" variant="primary" size="lg" loading={create.isPending} disabled={!name.trim()} icon={<ArrowRight className="size-4" />}>
            Set up my books
          </Button>
        </form>
      </section>
      <div className="grid-cols-2 mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {features.map(([icon, title, sub, tint], i) => (
          <div key={title} className={cx("tint-card lx-rise rounded-[20px] p-4", `tint-${tint}`)} style={{ animationDelay: `${i * 70}ms` }}>
            <span className="tint-chip grid size-9 place-items-center rounded-[12px]">{icon}</span>
            <p className="mt-3 text-[14px] font-semibold">{title}</p>
            <p className="mt-0.5 text-[12px] text-muted">{sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
