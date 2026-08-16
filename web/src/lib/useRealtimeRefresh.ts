import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Subscribe to realtime changes on one or more Postgres tables.
 * Calls `onRefresh` whenever an INSERT, UPDATE, or DELETE is detected.
 *
 * @param tables   – table names to listen on
 * @param onRefresh – callback to re-fetch data
 * @param filter   – optional: { column, value } to scope the subscription (e.g. school_id)
 */
export function useRealtimeRefresh(
  tables: string[],
  onRefresh: () => void,
  filter?: { column: string; value: string | null | undefined },
) {
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    if (!tables.length) return;
    if (filter && !filter.value) return; // skip until filter value is ready

    const channelName = `rt-${tables.join('-')}-${filter?.value ?? 'all'}-${Date.now()}`;

    const channel = supabase.channel(channelName);

    for (const table of tables) {
      const pgFilter = filter?.value ? `${filter.column}=eq.${filter.value}` : undefined;

      channel.on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table,
          ...(pgFilter ? { filter: pgFilter } : {}),
        },
        () => cbRef.current(),
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tables.join(','), filter?.column, filter?.value]);
}
