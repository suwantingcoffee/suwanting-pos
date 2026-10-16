export function validateSupabaseConfig(url?: string, key?: string) {
  const supabaseUrl = url?.trim();
  const publishableKey = key?.trim();
  if (!supabaseUrl && !publishableKey) return null;
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
  }
  const parsed = new URL(supabaseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" ||
    (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))) {
    throw new Error("Use a Supabase HTTPS project URL (HTTP is allowed for localhost).");
  }
  // Fail closed for secret/server keys. A public legacy JWT must explicitly
  // carry the anon role; decoding is only a configuration guard, not JWT auth.
  let isPublicKey = publishableKey.startsWith("sb_publishable_") && publishableKey.length > 20;
  if (publishableKey.startsWith("eyJ")) {
    try {
      const segment = publishableKey.split(".")[1];
      const payload: unknown = JSON.parse(atob(segment.replace(/-/g, "+").replace(/_/g, "/")));
      isPublicKey = typeof payload === "object" && payload !== null && "role" in payload && payload.role === "anon";
    } catch { isPublicKey = false; }
  }
  if (!isPublicKey) throw new Error("Frontend requires a publishable key or legacy anon key.");
  return { url: parsed.origin, publishableKey };
}
