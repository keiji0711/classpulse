export type SupabaseRelation<T> = T | T[] | null | undefined;

export interface EnrollmentProjection<TStudent, TSection> {
  student_id: string;
  section_id: string;
  student: SupabaseRelation<TStudent>;
  section: SupabaseRelation<TSection>;
}

export function unwrapRelation<T>(value: SupabaseRelation<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Builds a roster row using the enrollment's section as the historical source
 * of truth. A student's legacy section_id must never override this value.
 */
export function mapEnrollmentRosterRow<
  TStudent extends { id: string; section_id?: string | null },
  TSection,
>(row: EnrollmentProjection<TStudent, TSection>) {
  const student = unwrapRelation(row.student);
  const section = unwrapRelation(row.section);

  if (!student || !section) return null;

  return {
    ...student,
    section_id: row.section_id,
    section,
  };
}

export function mapEnrollmentRoster<
  TStudent extends { id: string; section_id?: string | null },
  TSection,
>(rows: EnrollmentProjection<TStudent, TSection>[]) {
  return rows
    .map(mapEnrollmentRosterRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);
}
