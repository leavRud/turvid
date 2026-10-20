import type { Session } from '@supabase/supabase-js';
import { supabase } from './client';

/** Отправляет на почту ссылку для входа. */
export async function sendLoginLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/**
 * Выход только на этом устройстве. По умолчанию supabase-js выходит везде (scope: 'global'),
 * и тогда на телефоне и других браузерах сессия умирает молча: база по старому токену ещё
 * отвечает, а функция media — уже 401.
 */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

/** Подписка на вход и выход. Возвращает функцию отписки. */
export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/** id вошедшего пользователя — первая папка в путях Storage. */
export async function currentUserId(): Promise<string> {
  const session = await getSession();
  const id = session?.user.id;
  if (!id) throw new Error('Нужно войти');
  return id;
}
