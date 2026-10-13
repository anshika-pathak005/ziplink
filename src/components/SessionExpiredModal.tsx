import { AlertCircle, LogIn } from "lucide-react";

type SessionExpiredModalProps = {
  isOpen: boolean;
  onConfirm: () => void;
};

export function SessionExpiredModal({ isOpen, onConfirm }: SessionExpiredModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl text-center">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-4">
          <AlertCircle className="h-6 w-6" />
        </div>

        <h2 className="text-xl font-bold tracking-tight text-foreground">
          Session Expired
        </h2>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          Your session has expired. Please log in again.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="btn-black flex w-full items-center justify-center gap-2 py-3 text-xs font-semibold cursor-pointer shadow-sm"
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>Go to Login</span>
          </button>
        </div>
      </div>
    </div>
  );
}
