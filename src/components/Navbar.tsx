import { Link } from "@tanstack/react-router";
import { ArrowRight, LayoutDashboard, LogOut, Menu } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
      {/* Brand Logo - Ziplink */}
      <Link to="/" className="group flex items-center gap-1">
        <span className="text-2xl font-black tracking-tighter text-foreground font-display">
          ziplink<span className="text-muted-foreground group-hover:text-foreground transition-colors">.</span>
        </span>
      </Link>

      {/* Navigation & Controls */}
      <nav className="flex items-center gap-3">
        {user ? (
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/dashboard"
              className="flex items-center gap-2 rounded-full border border-foreground/30 px-5 py-2 text-xs font-semibold text-foreground transition-all duration-300 hover:border-foreground hover:bg-foreground hover:text-background"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>Dashboard</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>

            <button
              onClick={logout}
              title="Sign Out"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/auth/login"
              className="hidden sm:inline-flex rounded-full px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign In
            </Link>
            <Link
              to="/auth/signup"
              className="flex items-center gap-2 rounded-full border border-foreground/30 px-5 py-2 text-xs font-semibold text-foreground transition-all duration-300 hover:border-foreground hover:bg-foreground hover:text-background"
            >
              <span>Get Started</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}
