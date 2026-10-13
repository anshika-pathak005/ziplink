export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  console.error("[Error Report]:", error, context);
}
