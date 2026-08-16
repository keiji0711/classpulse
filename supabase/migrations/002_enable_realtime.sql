-- Enable Realtime for attendance_records table
ALTER TABLE attendance_records REPLICA IDENTITY FULL;

-- Add to realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'attendance_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE attendance_records;
  END IF;
END $$;
