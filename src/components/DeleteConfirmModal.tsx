import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import type { ShortLink } from "@/lib/types";

type DeleteConfirmModalProps = {
  isOpen: boolean;
  link: ShortLink | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteConfirmModal({
  isOpen,
  link,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteConfirmModalProps) {
  if (!isOpen || !link) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>

          <div className="flex-1">
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              Delete Short Link
            </h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to delete this short link? The shortened URL will immediately stop redirecting.
            </p>

            <div className="mt-4 rounded-xl border border-border/80 bg-background/50 p-3">
              <div className="font-mono text-xs font-bold text-foreground">
                /{link.slug}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {link.originalUrl}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-xl border border-border px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-destructive px-5 py-2.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 cursor-pointer shadow-sm transition-colors disabled:opacity-50"
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            <span>Delete Link</span>
          </button>
        </div>
      </div>
    </div>
  );
}
