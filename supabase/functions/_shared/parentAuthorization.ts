type JwtPayload = Record<string, unknown>;

export interface AuthorizedParentRelationship {
  parentId: string;
  studentId: string;
  schoolId: string;
  familyId: string;
}

function claim(payload: JwtPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Resolve the token's anchor parent and prove that the requested student is in
 * the same explicit family. Every parent function that uses the service role
 * must pass through this guard before touching student data.
 */
export async function authorizeParentStudent(
  supabaseAdmin: any,
  payload: JwtPayload,
  studentId: string,
  requestedSchoolId?: string | null,
): Promise<AuthorizedParentRelationship | null> {
  const tokenParentId = claim(payload, "parent_id");
  const tokenSchoolId = claim(payload, "school_id");
  if (!tokenParentId || !tokenSchoolId) return null;
  if (requestedSchoolId && requestedSchoolId !== tokenSchoolId) return null;

  const { data: anchor, error: anchorError } = await supabaseAdmin
    .from("parents")
    .select("id, student_id, school_id, family_id")
    .eq("id", tokenParentId)
    .eq("school_id", tokenSchoolId)
    .maybeSingle();
  if (anchorError || !anchor?.family_id) return null;

  const { data: target, error: targetError } = await supabaseAdmin
    .from("parents")
    .select("id, student_id, school_id, family_id")
    .eq("student_id", studentId)
    .eq("school_id", tokenSchoolId)
    .eq("family_id", anchor.family_id)
    .maybeSingle();
  if (targetError || !target) return null;

  return {
    parentId: target.id,
    studentId: target.student_id,
    schoolId: target.school_id,
    familyId: target.family_id,
  };
}

/** Prove that a requested parent record belongs to the token's family. */
export async function authorizeParentRecord(
  supabaseAdmin: any,
  payload: JwtPayload,
  parentId: string,
): Promise<AuthorizedParentRelationship | null> {
  const tokenParentId = claim(payload, "parent_id");
  const tokenSchoolId = claim(payload, "school_id");
  if (!tokenParentId || !tokenSchoolId) return null;

  const { data: rows, error } = await supabaseAdmin
    .from("parents")
    .select("id, student_id, school_id, family_id")
    .in("id", [tokenParentId, parentId])
    .eq("school_id", tokenSchoolId);
  if (error || !rows) return null;

  const anchor = rows.find((row: any) => row.id === tokenParentId);
  const target = rows.find((row: any) => row.id === parentId);
  if (!anchor?.family_id || !target || target.family_id !== anchor.family_id) return null;

  return {
    parentId: target.id,
    studentId: target.student_id,
    schoolId: target.school_id,
    familyId: target.family_id,
  };
}

export function accessDenied(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Access denied" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

