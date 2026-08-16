-- Ensure messages table has REPLICA IDENTITY FULL for proper realtime support
ALTER TABLE public.messages REPLICA IDENTITY FULL;

-- Ensure the messages table is properly included in supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
