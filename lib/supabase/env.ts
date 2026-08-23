function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const SUPABASE_URL = () => required("NEXT_PUBLIC_SUPABASE_URL");
export const SUPABASE_PUBLISHABLE_KEY = () =>
  required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

// Server-only. Importing this from a client component is a bug; the throw is the guard.
export const SUPABASE_SECRET_KEY = () => required("SUPABASE_SECRET_KEY");
