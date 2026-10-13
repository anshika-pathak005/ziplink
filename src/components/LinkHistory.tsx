import type { ShortLink } from "@/lib/types";

export function LinkHistory({ links }: { links: ShortLink[] }) {
  if (links.length === 0) return null;

  return (
    <section className="reveal-up mt-10">
      <h2 className="text-[10px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
        recent
      </h2>
      <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl">
        {links.map((link) => (
          <li
            key={link.id}
            className="group flex items-center justify-between gap-4 px-5 py-3.5 transition-colors duration-300 hover:bg-foreground/4"
          >
            <span className="min-w-0 truncate text-sm text-muted-foreground transition-colors duration-300 group-hover:text-foreground/80">
              {link.originalUrl}
            </span>
            <span className="shrink-0 font-mono text-sm text-foreground">/{link.slug}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
