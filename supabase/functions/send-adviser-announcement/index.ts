import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { isStaleFcmTokenError, sendFcmNotification } from "../_shared/fcm.ts";
import { isValidUUID, sanitizeString } from "../_shared/validation.ts";
import { getParentAccessMap } from "../_shared/parentAccess.ts";

const ANNOUNCEMENT_TYPES = new Set(["general", "meeting", "reminder", "urgent"]);

function typeLabel(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyAuth(req);
  if (auth.error || !auth.user) {
    return new Response(JSON.stringify({ error: auth.error ?? "Unauthorized" }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const sectionIds = Array.isArray(body.section_ids)
      ? [...new Set(body.section_ids.filter((id: unknown) => typeof id === "string"))]
      : [];
    const academicYearId = body.academic_year_id;
    const announcementType = sanitizeString(body.announcement_type).toLowerCase();
    const title = sanitizeString(body.title).slice(0, 120);
    const message = sanitizeString(body.message).slice(0, 2000);
    const eventAt = body.event_at ? new Date(body.event_at) : null;

    if (
      sectionIds.length === 0
      || sectionIds.length > 20
      || sectionIds.some((id) => !isValidUUID(id))
      || (academicYearId && !isValidUUID(academicYearId))
      || !ANNOUNCEMENT_TYPES.has(announcementType)
      || !title
      || !message
      || (body.event_at && (!eventAt || Number.isNaN(eventAt.getTime())))
    ) {
      return new Response(JSON.stringify({ error: "Invalid announcement details" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: teacher } = await admin
      .from("users")
      .select("id, school_id, full_name, role")
      .eq("id", auth.user.id)
      .single();

    if (!teacher || teacher.role !== "instructor" || !teacher.school_id) {
      return new Response(JSON.stringify({ error: "Teacher access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: advisorySections, error: sectionsError } = await admin
      .from("sections")
      .select("id, name, grade_level")
      .in("id", sectionIds)
      .eq("school_id", teacher.school_id)
      .eq("adviser_id", teacher.id);

    if (sectionsError || !advisorySections || advisorySections.length !== sectionIds.length) {
      return new Response(JSON.stringify({ error: "You can only announce to your advisory sections" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let effectiveYearId: string | null = academicYearId ?? null;
    if (effectiveYearId) {
      const { data: year } = await admin
        .from("academic_years")
        .select("id")
        .eq("id", effectiveYearId)
        .eq("school_id", teacher.school_id)
        .maybeSingle();
      if (!year) {
        return new Response(JSON.stringify({ error: "Academic year not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const { data: currentYear } = await admin
        .from("academic_years")
        .select("id")
        .eq("school_id", teacher.school_id)
        .eq("is_current", true)
        .maybeSingle();
      effectiveYearId = currentYear?.id ?? null;
    }

    let recipients: { student_id: string; section_id: string }[] = [];
    if (effectiveYearId) {
      const { data } = await admin
        .from("student_enrollments")
        .select("student_id, section_id")
        .eq("school_id", teacher.school_id)
        .eq("academic_year_id", effectiveYearId)
        .in("section_id", sectionIds);
      recipients = data ?? [];
    } else {
      const { data } = await admin
        .from("students")
        .select("id, section_id")
        .eq("school_id", teacher.school_id)
        .in("section_id", sectionIds);
      recipients = (data ?? []).map((student) => ({
        student_id: student.id,
        section_id: student.section_id,
      }));
    }

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ error: "No students found in the selected section" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let schedulesQuery = admin
      .from("schedules")
      .select("id, section_id, subject:subjects(id, name, code)")
      .eq("school_id", teacher.school_id)
      .in("section_id", sectionIds)
      .order("created_at");
    if (effectiveYearId) {
      schedulesQuery = schedulesQuery.eq("academic_year_id", effectiveYearId);
    }
    const { data: schedules } = await schedulesQuery;
    const scheduleBySection = new Map<string, any>();
    for (const schedule of schedules ?? []) {
      if (!scheduleBySection.has(schedule.section_id)) {
        scheduleBySection.set(schedule.section_id, schedule);
      }
    }

    const rows = recipients.map((recipient) => ({
      student_id: recipient.student_id,
      instructor_id: teacher.id,
      schedule_id: scheduleBySection.get(recipient.section_id)?.id ?? null,
      school_id: teacher.school_id,
      section_id: recipient.section_id,
      academic_year_id: effectiveYearId,
      message_type: "adviser_announcement",
      announcement_type: announcementType,
      title,
      content: message,
      event_at: eventAt?.toISOString() ?? null,
    }));

    const { error: insertError } = await admin.from("messages").insert(rows);
    if (insertError) {
      console.error("[send-adviser-announcement] insert failed", insertError);
      return new Response(JSON.stringify({ error: "Failed to save the announcement" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const studentIds = recipients.map((recipient) => recipient.student_id);
    const [{ data: parents }, parentAccess] = await Promise.all([
      admin
        .from("parents")
        .select("student_id, fcm_push_token")
        .in("student_id", studentIds)
        .not("fcm_push_token", "is", null),
      getParentAccessMap(admin, studentIds),
    ]);

    const disabled = new Set(
      studentIds.filter((studentId) => parentAccess.get(studentId) !== true),
    );
    const tokenByStudent = new Map<string, string>();
    for (const parent of parents ?? []) {
      const token = parent.fcm_push_token?.trim();
      if (token && !tokenByStudent.has(parent.student_id)) {
        tokenByStudent.set(parent.student_id, token);
      }
    }

    const sectionById = new Map(advisorySections.map((section) => [section.id, section]));
    const pushTasks = recipients
      .filter((recipient) => !disabled.has(recipient.student_id) && tokenByStudent.has(recipient.student_id))
      .map(async (recipient) => {
        const section = sectionById.get(recipient.section_id);
        const schedule = scheduleBySection.get(recipient.section_id);
        const subject = Array.isArray(schedule?.subject) ? schedule.subject[0] : schedule?.subject;
        const token = tokenByStudent.get(recipient.student_id)!;
        try {
          await sendFcmNotification({
            token,
            title: `${typeLabel(announcementType)}: ${title}`,
            body: message,
            data: {
              student_id: recipient.student_id,
              schedule_id: schedule?.id ?? "announcement",
              subject_id: subject?.id ?? `advisory-${recipient.section_id}`,
              subject_name: "Advisory Announcements",
              subject_code: section ? `${section.grade_level} ${section.name}` : "Advisory",
              instructor_name: teacher.full_name,
              notification_type: "adviser_announcement",
            },
          });
        } catch (error) {
          if (isStaleFcmTokenError(error)) {
            await admin.from("parents").update({ fcm_push_token: null }).eq("student_id", recipient.student_id).eq("fcm_push_token", token);
          }
          throw error;
        }
      });

    const pushResults = await Promise.allSettled(pushTasks);
    const delivered = pushResults.filter((result) => result.status === "fulfilled").length;

    return new Response(JSON.stringify({
      success: true,
      recipients: recipients.length,
      push_delivered: delivered,
      notifications_skipped: recipients.length - pushTasks.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[send-adviser-announcement]", error);
    return new Response(JSON.stringify({ error: "Unable to send announcement" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
