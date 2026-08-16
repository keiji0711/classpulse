export async function isParentAccessEnabled(
  supabaseAdmin: any,
  studentId: string,
): Promise<boolean> {
  const { data: effectiveAccess, error: effectiveAccessError } = await supabaseAdmin
    .rpc("parent_access_is_enabled", { p_student_id: studentId });

  if (!effectiveAccessError && typeof effectiveAccess === "boolean") {
    return effectiveAccess;
  }

  // Backward-compatible fallback while migration 045 is being rolled out.
  const { data } = await supabaseAdmin
    .from("student_notification_preferences")
    .select("enabled")
    .eq("student_id", studentId)
    .maybeSingle();

  return data?.enabled !== false;
}

export async function getParentAccessMap(
  supabaseAdmin: any,
  studentIds: string[],
): Promise<Map<string, boolean>> {
  const uniqueIds = [...new Set(studentIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .rpc("parent_access_statuses", { p_student_ids: uniqueIds });

  if (!error && Array.isArray(data)) {
    return new Map(data.map((row: any) => [row.student_id, row.enabled === true]));
  }

  const { data: preferences } = await supabaseAdmin
    .from("student_notification_preferences")
    .select("student_id, enabled")
    .in("student_id", uniqueIds);
  const disabled = new Set(
    (preferences ?? [])
      .filter((row: any) => row.enabled === false)
      .map((row: any) => row.student_id),
  );
  return new Map(uniqueIds.map((studentId) => [studentId, !disabled.has(studentId)]));
}
