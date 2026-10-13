import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Sparkles, Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { loginUserFn } from "@/lib/server-fns";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth/login")({
  head: () => ({
    meta: [{ title: "Sign In - Ziplink" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { user, isLoading: authLoading, login } = useAuth();
  const navigate = useNavigate();

  // Auto-redirect to dashboard if user has an active session
  useEffect(() => {
    if (!authLoading && user) {
      void navigate({ to: "/dashboard" });
    }
  }, [user, authLoading, navigate]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await loginUserFn({ data: { email, password } });
      setLoading(false);

      if (!res.ok) {
        setError(res.error);
        return;
      }

      login(res.user);
      void navigate({ to: "/dashboard" });
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "Failed to sign in. Please try again.");
    }
  }

  return (
    <main className="relative min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      <div className="relative flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-3xl border border-border bg-card p-8 shadow-sm sm:p-10">
            <div className="text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm mb-4">
                <Sparkles className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Welcome Back
              </h1>
              <p className="mt-2 text-xs text-muted-foreground">
                Sign in to access your shortened links, analytics, and custom slugs.
              </p>
            </div>

            {error && (
              <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive text-center font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
                  Email Address
                </label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-3.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className="w-full rounded-xl border border-border bg-white py-3 pl-10 pr-4 text-sm font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
                  Password
                </label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-border bg-white py-3 pl-10 pr-4 text-sm font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-black group flex w-full items-center justify-center gap-2 py-3.5 text-sm font-semibold cursor-pointer disabled:opacity-50 mt-6 shadow-sm"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 text-center text-xs text-muted-foreground">
              Don't have an account?{" "}
              <Link
                to="/auth/signup"
                className="font-semibold text-foreground underline-offset-4 hover:underline"
              >
                Create one for free
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
