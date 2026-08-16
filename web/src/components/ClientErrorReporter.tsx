import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export default function ClientErrorReporter() {
  const { user } = useAuth();
  const sent = useRef(new Set<string>());

  useEffect(() => {
    if (!user) return;
    const report = (message: string, stack?: string) => {
      const safeMessage = message.slice(0, 1000);
      const signature = `${location.pathname}:${safeMessage}`;
      if (sent.current.has(signature) || sent.current.size >= 25) return;
      sent.current.add(signature);
      void supabase.from('application_error_events').insert({
        user_id: user.id,
        school_id: user.school_id,
        source: 'web',
        severity: 'error',
        message: safeMessage,
        stack: stack?.slice(0, 8000) ?? null,
        route: location.pathname,
        context: { app_version: import.meta.env.VITE_APP_VERSION ?? 'web' },
      });
    };
    const onError = (event: ErrorEvent) => report(event.message || 'Unhandled browser error', event.error?.stack);
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      report(reason instanceof Error ? reason.message : String(reason), reason instanceof Error ? reason.stack : undefined);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, [user]);

  return null;
}
