import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { ShortLink } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ResultCard({ link }: { link: ShortLink }) {
  const [copied, setCopied] = useState(false);

  const fullUrl =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${link.shortUrl}`
      : `http://${link.shortUrl}`;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-sm transition-all duration-300">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
          Generated Link
        </span>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground">
            Fast Edge ⚡
          </span>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <a
            href={fullUrl}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl font-display"
          >
            <span className="hover:underline underline-offset-4">{link.shortUrl}</span>
            <ExternalLink className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
          </a>
          <p className="mt-1.5 truncate text-xs text-muted-foreground">{link.originalUrl}</p>
        </div>

        <button
          type="button"
          onClick={copy}
          className={cn(
            "flex items-center justify-center gap-2 rounded-full px-6 py-3 text-xs font-semibold tracking-wide uppercase transition-all duration-200",
            copied
              ? "bg-emerald-600 text-white"
              : "btn-black",
          )}
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              <span>Copy Link</span>
            </>
          )}
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <Stat label="slug" value={`/${link.slug}`} />
        <Stat label="clicks" value={String(link.clicksCount ?? 0)} />
        <Stat
          label="created"
          value={new Date(link.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-border px-3.5 py-1 text-[11px] font-medium text-foreground">
      <span className="uppercase text-muted-foreground tracking-wider text-[10px] mr-1">{label}:</span>{" "}
      <span className="font-semibold font-mono">{value}</span>
    </span>
  );
}
