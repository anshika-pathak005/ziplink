import { useEffect, useState, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Plus,
  Link2,
  BarChart3,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Search,
  Loader2,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/hooks/use-auth";
import { getUserLinksFn, shortenUrlFn, deleteUserLinkFn } from "@/lib/server-fns";
import type { ShortLink } from "@/lib/types";
import { SessionExpiredModal } from "@/components/SessionExpiredModal";
import { DeleteConfirmModal } from "@/components/DeleteConfirmModal";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [{ title: "Dashboard - Ziplink" }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user, isLoading: authLoading, expireSession } = useAuth();
  const navigate = useNavigate();

  const [links, setLinks] = useState<ShortLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create Modal state
  const [showModal, setShowModal] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete Modal state
  const [linkToDelete, setLinkToDelete] = useState<ShortLink | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Session Expired Modal state
  const [showSessionExpired, setShowSessionExpired] = useState(false);

  // Copy state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleSessionExpired = useCallback(() => {
    expireSession();
    setShowSessionExpired(true);
  }, [expireSession]);

  useEffect(() => {
    if (!authLoading && !user && !showSessionExpired) {
      void navigate({ to: "/auth/login" });
    }
  }, [user, authLoading, showSessionExpired, navigate]);

  const loadLinks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await getUserLinksFn();
      if (!res.ok) {
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        console.error("Failed to load user links:", res.error);
        return;
      }
      setLinks(res.links || []);
    } catch (err) {
      console.error("Failed to load links:", err);
    } finally {
      setLoading(false);
    }
  }, [user, handleSessionExpired]);

  useEffect(() => {
    if (user) {
      void loadLinks();
    }
  }, [user, loadLinks]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setCreateError(null);
    setCreating(true);

    const opts: { customSlug?: string; title?: string } = {};
    if (customSlug.trim()) opts.customSlug = customSlug.trim();
    if (title.trim()) opts.title = title.trim();

    try {
      const res = await shortenUrlFn({
        data: {
          url: newUrl,
          options: opts,
          requireAuth: true,
        },
      });
      setCreating(false);

      if (!res.ok) {
        if (res.status === 401) {
          setShowModal(false);
          handleSessionExpired();
          return;
        }
        setCreateError(res.error);
        return;
      }

      setNewUrl("");
      setCustomSlug("");
      setTitle("");
      setShowModal(false);
      void loadLinks();
    } catch (err: any) {
      setCreating(false);
      setCreateError(err?.message || "Failed to create short link.");
    }
  }

  async function handleConfirmDelete() {
    if (!linkToDelete || !user) return;
    setDeleting(true);

    try {
      const res = await deleteUserLinkFn({ data: { linkId: linkToDelete.id } });
      setDeleting(false);

      if (!res.ok) {
        if (res.status === 401) {
          setLinkToDelete(null);
          handleSessionExpired();
          return;
        }
        console.error("Delete failed:", res.error);
        return;
      }

      setLinks((prev) => prev.filter((l) => l.id !== linkToDelete.id));
      setLinkToDelete(null);
    } catch (err) {
      setDeleting(false);
      console.error("Failed to delete link:", err);
    }
  }

  function handleSessionExpiredConfirm() {
    setShowSessionExpired(false);
    void navigate({ to: "/auth/login" });
  }

  function getFullShortUrl(shortUrl: string) {
    const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";
    return `${protocol}//${shortUrl}`;
  }

  async function handleCopy(link: ShortLink) {
    try {
      await navigator.clipboard.writeText(getFullShortUrl(link.shortUrl));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  }

  const filteredLinks = links.filter(
    (l) =>
      l.slug.toLowerCase().includes(search.toLowerCase()) ||
      l.originalUrl.toLowerCase().includes(search.toLowerCase()) ||
      (l.title && l.title.toLowerCase().includes(search.toLowerCase())),
  );

  const totalClicks = links.reduce((sum, l) => sum + l.clicksCount, 0);

  if (authLoading || (!user && loading && !showSessionExpired)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user && !showSessionExpired) return null;

  return (
    <main className="relative min-h-screen bg-background text-foreground flex flex-col pb-20">
      <Navbar />

      <div className="relative mx-auto w-full max-w-6xl px-6 pt-6">
        {/* Header Title & Create Action */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Links Dashboard
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage your shortened URLs, custom slugs, and performance telemetry.
            </p>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="btn-black inline-flex items-center justify-center gap-2 px-5 py-3 text-xs font-semibold shadow-sm cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Create Short Link</span>
          </button>
        </div>

        {/* Top KPI Metrics Cards */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-border/70 bg-card/60 p-5 backdrop-blur-xl">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Total Links
            </span>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {links.length}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/60 p-5 backdrop-blur-xl">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Total Clicks
            </span>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {totalClicks}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/60 p-5 backdrop-blur-xl">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Active Links
            </span>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {links.length}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/60 p-5 backdrop-blur-xl">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Avg. Clicks / Link
            </span>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {links.length > 0 ? (totalClicks / links.length).toFixed(1) : 0}
            </div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex flex-1 items-center max-w-md">
            <Search className="absolute left-3.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by slug, title or destination URL..."
              className="w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-4 text-xs font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10 transition-all"
            />
          </div>

          <div className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{filteredLinks.length}</span> of{" "}
            {links.length} links
          </div>
        </div>

        {/* Links Table */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredLinks.length === 0 ? (
            <div className="p-12 text-center">
              <Link2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">No links found</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {search
                  ? "No links matched your search term."
                  : "Create your first shortened link to get started."}
              </p>
              {!search && (
                <button
                  onClick={() => setShowModal(true)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-foreground hover:bg-card/80 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create Link</span>
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {filteredLinks.map((link) => (
                <div
                  key={link.id}
                  className="group flex flex-col gap-4 p-5 transition-colors hover:bg-foreground/3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-foreground tracking-tight">
                        /{link.slug}
                      </span>
                      {link.title && (
                        <span className="rounded-md border border-border/60 bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                          {link.title}
                        </span>
                      )}
                    </div>

                    <a
                      href={getFullShortUrl(link.shortUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors truncate max-w-full"
                    >
                      <span className="truncate">{link.originalUrl}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                      <BarChart3 className="h-3.5 w-3.5 text-foreground/70" />
                      <span className="font-semibold text-foreground">{link.clicksCount}</span>
                      <span>clicks</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleCopy(link)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background/50 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                        title="Copy short link"
                      >
                        {copiedId === link.id ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>

                      <button
                        onClick={() => setLinkToDelete(link)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background/50 text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                        title="Delete link"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Link Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Create New Short Link
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste your target URL and optionally pick a custom vanity slug.
            </p>

            {createError && (
              <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreate} className="mt-5 space-y-4">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1">
                  Destination URL *
                </label>
                <input
                  type="url"
                  required
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://example.com/long-page-path"
                  className="w-full rounded-xl border border-border bg-white py-2.5 px-3.5 text-xs font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10 transition-all"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1">
                  Custom Slug (Optional)
                </label>
                <div className="flex items-center rounded-xl border border-border bg-white px-3.5 py-2.5 text-xs text-foreground focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/10 transition-all">
                  <span className="text-muted-foreground font-mono mr-1">ziplink.link/</span>
                  <input
                    type="text"
                    value={customSlug}
                    onChange={(e) => setCustomSlug(e.target.value)}
                    placeholder="my-custom-name"
                    className="w-full bg-transparent outline-none font-mono text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1">
                  Link Title (Optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="My Portfolio Link"
                  className="w-full rounded-xl border border-border bg-white py-2.5 px-3.5 text-xs font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground focus:ring-2 focus:ring-foreground/10 transition-all"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-border px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="btn-black flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create Link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={!!linkToDelete}
        link={linkToDelete}
        isDeleting={deleting}
        onCancel={() => setLinkToDelete(null)}
        onConfirm={handleConfirmDelete}
      />

      {/* Session Expired Modal */}
      <SessionExpiredModal
        isOpen={showSessionExpired}
        onConfirm={handleSessionExpiredConfirm}
      />
    </main>
  );
}
