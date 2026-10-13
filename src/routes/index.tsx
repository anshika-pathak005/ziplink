import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { Navbar } from "@/components/Navbar";
import { ShortenForm } from "@/components/ShortenForm";
import { ResultCard } from "@/components/ResultCard";
import { LinkHistory } from "@/components/LinkHistory";
import { shortenUrlFn } from "@/lib/server-fns";
import type { ShortLink } from "@/lib/types";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ziplink - Modern URL Shortener" },
      {
        name: "description",
        content:
          "Bring your long links to life in the shortened world with sub-5ms redirection speed, analytics, and custom vanity slugs.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const { user } = useAuth();
  const [link, setLink] = useState<ShortLink | null>(null);
  const [history, setHistory] = useState<ShortLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleShorten(url: string): Promise<boolean> {
    setError(null);
    setLoading(true);
    try {
      const result = await shortenUrlFn({ data: { url } });
      setLoading(false);

      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setLink(result.link);
      setHistory((prev) => [result.link, ...prev.filter((l) => l.id !== result.link.id)].slice(0, 5));
      return true;
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "Failed to shorten URL. Please try again.");
      return false;
    }
  }

  return (
    <main className="relative min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      {/* Main Centered Hero Section */}
      <section className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-12 pb-20 sm:pt-20 text-center">

        {/* Main Headline */}
        <h1 className="text-5xl font-black leading-[0.96] tracking-tight sm:text-7xl lg:text-8xl font-display text-foreground">
          Bringing your <br />
          links to life in the <br />
          <span className="text-muted-foreground font-semibold">shortened world.</span>
        </h1>

        <p className="mt-8 text-base text-muted-foreground max-w-xl leading-relaxed">
          Transform unwieldy URLs into lightning-fast, shareable short links. Powered by Redis RAM caching, real-time telemetry, and custom vanity slugs.
        </p>

        {/* Shorten Form Container */}
        <div className="mt-10 w-full max-w-2xl text-left">
          <ShortenForm onSubmit={handleShorten} isLoading={loading} error={error} />
        </div>

        {/* Generated Result Card */}
        {link && (
          <div className="mt-6 w-full max-w-2xl text-left transition-all duration-300">
            <ResultCard key={link.id} link={link} />
          </div>
        )}

        {/* Session Link History */}
        <div className="w-full max-w-2xl text-left">
          <LinkHistory links={history} />
        </div>

        {/* Guest Conversion Card - Only shown when user is not logged in */}
        {!user && (
          <div className="mt-16 w-full max-w-2xl text-center">
            <div className="rounded-3xl border border-border bg-card/60 p-8 sm:p-10 backdrop-blur-xl shadow-sm transition-all hover:border-foreground/30">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                <span>Pro Account</span>
                <span className="rounded-full bg-foreground text-background px-2 py-0.5 text-[8px] font-bold">FREE</span>
              </div>

              <h3 className="mt-4 text-2xl font-bold tracking-tight text-foreground font-display">
                Save your links permanently
              </h3>
              <p className="mt-2 text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                Guest links expire. Create a free Ziplink account to store links forever, use custom vanity slugs, and access click telemetry.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Link
                  to="/auth/signup"
                  className="btn-black inline-flex items-center gap-2 px-6 py-3 text-xs font-semibold cursor-pointer shadow-sm"
                >
                  <span>Create Account Free</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  to="/auth/login"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-5 py-3 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                >
                  <span>Sign In</span>
                </Link>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Clean Minimal Footer */}
      <footer className="mt-auto border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        ziplink. · modern url engine
      </footer>
    </main>
  );
}
