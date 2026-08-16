-- Limit new grades and exam scores to the school's three-quarter calendar.
-- NOT VALID preserves any historical fourth-quarter records while enforcing
-- the three-quarter rule for all new or updated rows.

alter table public.grades
  drop constraint if exists grades_quarter_check;

alter table public.grades
  add constraint grades_quarter_check
  check (quarter between 1 and 3) not valid;

alter table public.exam_scores
  drop constraint if exists exam_scores_three_quarters_check;

alter table public.exam_scores
  add constraint exam_scores_three_quarters_check
  check (exam_period in (
    '1st_quarter'::public.exam_period,
    '2nd_quarter'::public.exam_period,
    '3rd_quarter'::public.exam_period
  )) not valid;
