import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error('Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (см. .env.example)');
}

// Implicit flow: ссылка из письма должна работать, даже если почтовый клиент
// откроет её в другом браузере, чем тот, где её запросили (PKCE так не умеет).
export const supabase = createClient(url, key, {
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
});
