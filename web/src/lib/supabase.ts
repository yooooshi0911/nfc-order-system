import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  '';

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn(
    'Warning: Supabase credentials are missing. Please check your .env.local file.'
  );
}

// 共通で利用する Supabase クライアント
export const supabase = createClient(supabaseUrl, supabasePublishableKey);
