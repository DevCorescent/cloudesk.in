import { Globe, PanelsTopLeft } from "lucide-react";
import Link from "next/link";
import { Badge } from "./ui/primitives";
import { timeAgo } from "@/lib/client/format";
import type { ProjectSummary } from "@/lib/client/types";

const TINTS = ["lavender", "peach", "mint", "sky", "butter", "rose"] as const;
/** A stable soft colour per project, so each card is easy to tell apart. */
const tintOf = (id: string) => TINTS[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];

export function ProjectCard({ p }: { p: ProjectSummary }) {
  return (
    <Link
      href={`/projects/${p.id}`}
      className={`tint-card tint-${tintOf(p.id)} group flex flex-col rounded-[var(--radius-lg)] p-4 transition-[transform,box-shadow] duration-[var(--dur)] hover:-translate-y-0.5 hover:shadow-md`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="tint-chip flex size-8 items-center justify-center rounded-[var(--radius-md)]">
          <PanelsTopLeft className="size-4" aria-hidden />
        </span>
        {p.productionDeploymentId ? (
          <Badge tone="success">
            <Globe className="size-3" aria-hidden /> Live
          </Badge>
        ) : (
          <Badge>Draft</Badge>
        )}
      </div>
      <h3 className="mt-3 truncate text-sm font-semibold text-fg">{p.name}</h3>
      <p className="mt-0.5 line-clamp-2 min-h-[2.6em] text-[13px] text-muted">{p.description || "No description"}</p>
      <p className="mt-3 text-xs text-subtle">Edited {timeAgo(p.updatedAt)}</p>
    </Link>
  );
}
