-- ============================================
-- Backfill existing data into academic years
-- Creates a default academic year per school
-- and tags all existing records to it.
-- (Idempotent — safe to re-run)
-- ============================================

-- Step 1: Create a "2025-2026" academic year for every school that doesn't have one yet
INSERT INTO academic_years (school_id, name, start_date, end_date, is_current)
SELECT
  s.id,
  '2025-2026',
  '2025-06-01',
  '2026-03-31',
  true
FROM schools s
WHERE NOT EXISTS (
  SELECT 1 FROM academic_years ay WHERE ay.school_id = s.id
)
ON CONFLICT DO NOTHING;

-- Step 2: Enroll all existing students into the current academic year
INSERT INTO student_enrollments (student_id, section_id, academic_year_id, school_id)
SELECT
  st.id,
  st.section_id,
  ay.id,
  st.school_id
FROM students st
JOIN academic_years ay ON ay.school_id = st.school_id AND ay.is_current = true
WHERE st.section_id IS NOT NULL
ON CONFLICT (student_id, academic_year_id) DO NOTHING;

-- Step 3: Tag existing schedules with the current academic year
UPDATE schedules s
SET academic_year_id = ay.id
FROM academic_years ay
WHERE ay.school_id = s.school_id
  AND ay.is_current = true
  AND s.academic_year_id IS NULL;

-- Step 4: Tag existing grades with the current academic year
UPDATE grades g
SET academic_year_id = ay.id
FROM academic_years ay
WHERE ay.school_id = g.school_id
  AND ay.is_current = true
  AND g.academic_year_id IS NULL;
