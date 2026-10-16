import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { validateSupabaseConfig } from "@/lib/supabase-config";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

function createSupabaseClient() {
  const config = validateSupabaseConfig(supabaseUrl, supabasePublishableKey);
  if (!config) return null;
  return createClient<Database>(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      storageKey: "suwanting-pos-auth",
    },
  });
}

export const supabase = createSupabaseClient();
