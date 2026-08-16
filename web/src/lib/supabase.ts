import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || supabaseUrl === 'your-supabase-url-here' || !supabaseAnonKey || supabaseAnonKey === 'your-supabase-anon-key-here') {
  console.warn('Supabase credentials not configured. Auth features will not work until you set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(
  supabaseUrl && supabaseUrl !== 'your-supabase-url-here' ? supabaseUrl : 'https://placeholder.supabase.co',
  supabaseAnonKey && supabaseAnonKey !== 'your-supabase-anon-key-here' ? supabaseAnonKey : 'placeholder-key',
  {
    auth: {
      // A returning teacher should reuse the stored session instead of creating a
      // new password-login request each time the app is opened.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
