export interface StaffProfile {
  id: string;
  role: "super_admin" | "school_admin" | "instructor";
  school_id: string | null;
  is_platform_owner?: boolean;
  account_status?: "active" | "deactivated";
}

export async function getStaffProfile(
  admin: any,
  userId: string,
): Promise<StaffProfile | null> {
  const { data, error } = await admin
    .from("users")
    .select("id, role, school_id, is_platform_owner, account_status")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data || data.account_status === "deactivated" || !["super_admin", "school_admin", "instructor"].includes(data.role)) {
    return null;
  }
  return data as StaffProfile;
}

export async function authorizePlatformOwner(admin: any, userId: string): Promise<boolean> {
  const profile = await getStaffProfile(admin, userId);
  return profile?.role === "super_admin" && profile.is_platform_owner === true;
}

export async function authorizeStaffStudents(
  admin: any,
  userId: string,
  studentIds: string[],
): Promise<StaffProfile | null> {
  const profile = await getStaffProfile(admin, userId);
  if (!profile) return null;
  if (profile.role === "super_admin") {
    return profile.is_platform_owner ? profile : null;
  }
  if (!profile.school_id || studentIds.length === 0) return null;

  const uniqueIds = [...new Set(studentIds)];
  const { data: students, error } = await admin
    .from("students")
    .select("id")
    .in("id", uniqueIds)
    .eq("school_id", profile.school_id);
  if (error || (students?.length ?? 0) !== uniqueIds.length) return null;
  return profile;
}

export async function authorizeAttendanceRecord(
  admin: any,
  userId: string,
  record: { student_id?: string; schedule_id?: string },
): Promise<StaffProfile | null> {
  if (!record.student_id || !record.schedule_id) return null;
  const profile = await authorizeStaffStudents(admin, userId, [record.student_id]);
  if (!profile) return null;
  if (profile.role !== "instructor") return profile;

  const { data: schedule } = await admin
    .from("schedules")
    .select("id")
    .eq("id", record.schedule_id)
    .eq("instructor_id", userId)
    .eq("school_id", profile.school_id)
    .maybeSingle();
  return schedule ? profile : null;
}

export async function authorizeAttendanceBatch(
  admin: any,
  userId: string,
  records: Array<{ student_id?: string; schedule_id?: string }>,
): Promise<StaffProfile | null> {
  const studentIds = records.map((record) => record.student_id ?? "").filter(Boolean);
  const scheduleIds = [...new Set(records.map((record) => record.schedule_id ?? "").filter(Boolean))];
  if (studentIds.length !== records.length || scheduleIds.length === 0) return null;
  const profile = await authorizeStaffStudents(admin, userId, studentIds);
  if (!profile || profile.role !== "instructor") return profile;

  const { data: schedules, error } = await admin
    .from("schedules")
    .select("id")
    .in("id", scheduleIds)
    .eq("instructor_id", userId)
    .eq("school_id", profile.school_id);
  if (error || (schedules?.length ?? 0) !== scheduleIds.length) return null;
  return profile;
}

export function staffAccessDenied(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Not authorized for the requested school records" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
