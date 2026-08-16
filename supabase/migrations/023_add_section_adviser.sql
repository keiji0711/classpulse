-- Migration: Add adviser_id to sections table
ALTER TABLE public.sections ADD COLUMN IF NOT EXISTS adviser_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Optional: Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sections_adviser_id ON public.sections(adviser_id);
