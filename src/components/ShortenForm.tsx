import { useState, type FormEvent } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onSubmit: (url: string) => void | boolean | Promise<void | boolean>;
  isLoading?: boolean;
  error?: string | null;
};

export function ShortenForm({ onSubmit, isLoading = false, error }: Props) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isLoading || !value.trim()) return;
    const res = await onSubmit(value);
    if (res !== false) {
      setValue("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div
        className={cn(
          "relative flex flex-col gap-2 rounded-3xl p-2.5 transition-all duration-300 sm:flex-row sm:items-center",
          "bg-white border border-foreground/15 shadow-md hover:border-foreground/30",
          focused && "border-foreground ring-2 ring-foreground/10",
        )}
      >
        <div className="relative flex flex-1 items-center gap-3 px-4 py-2">
          <Link2
            className={cn(
              "h-5 w-5 shrink-0 transition-colors duration-200",
              focused ? "text-foreground" : "text-muted-foreground",
            )}
          />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Paste your long link here (e.g. https://domain.com/very-long-path)..."
            spellCheck={false}
            className="w-full bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/80 placeholder:font-normal"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="btn-black flex items-center justify-center gap-2 px-8 py-3.5 text-xs font-semibold tracking-wide uppercase disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <span>Shorten</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="mt-3 pl-4 text-xs font-medium text-destructive">
          {error}
        </div>
      )}
    </form>
  );
}
