import { supabaseConfig } from "./config.js";

const sdk = globalThis.supabase;
const isConfigured = Boolean(supabaseConfig.url && supabaseConfig.publishableKey);

let client = null;
if (!isConfigured) {
  console.error("Supabase configuration is unavailable. Check the server's .env setup.");
} else if (typeof sdk?.createClient !== "function") {
  console.error("Supabase SDK failed to load. Check the SDK script path and load order.");
} else {
  try {
    client = sdk.createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
  } catch {
    console.error("Supabase client initialization failed. Check the project URL and publishable key format.");
  }
}

export const supabase = client;
