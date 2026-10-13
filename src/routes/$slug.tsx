// Handles dynamic short URL routes such as /abc123.
// It extracts the slug from the URL, looks up the corresponding shortened URL,
// records the click, and redirects the user to the original destination URL.
// If the slug does not exist, the user is redirected to the home page.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getLinkAndRecordClickFn } from "@/lib/server-fns";

export const Route = createFileRoute("/$slug")({
  loader: async ({ params }) => {
    const { slug } = params;

    // Skip special app routes or assets if matched here
    if (
      !slug ||
      slug === "auth" ||
      slug === "dashboard" ||
      slug === "api" ||
      slug === "favicon.ico"
    ) {
      return;
    }

    const link = await getLinkAndRecordClickFn({ data: slug });

    if (!link) {
      throw redirect({ to: "/" });
    }

    // Perform HTTP 302 Redirect to destination URL
    throw redirect({
      href: link.originalUrl,
    });
  },
  component: RedirectComponent,
});

function RedirectComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground font-mono text-xs">
      Redirecting...
    </div>
  );
}
