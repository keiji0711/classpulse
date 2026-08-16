import { isStaleFcmTokenError, sendFcmNotification } from "./fcm.ts";
import { isParentAccessEnabled } from "./parentAccess.ts";

export async function processLearnerAssessmentPush(admin: any, job: any): Promise<"delivered" | "skipped" | "no_token"> {
  const startedAt = Date.now();
  const assessmentId = job.payload?.assessment_id;
  const { data: assessment } = await admin
    .from("learner_assessments")
    .select("id,student_id,school_id,assessment_period,domain")
    .eq("id", assessmentId)
    .maybeSingle();
  if (!assessment) throw new Error("Learner assessment no longer exists");

  const baseLog = {
    school_id: assessment.school_id,
    student_id: assessment.student_id,
    schedule_id: null,
    attendance_record_id: null,
    type: "learner_assessment_push",
  };

  if (!(await isParentAccessEnabled(admin, assessment.student_id))) {
    await admin.from("notification_logs").insert({ ...baseLog, status: "skipped", error_message: "Parent access is inactive", latency_ms: Date.now() - startedAt });
    return "skipped";
  }

  const { data: parent } = await admin
    .from("parents")
    .select("id,fcm_push_token")
    .eq("student_id", assessment.student_id)
    .not("fcm_push_token", "is", null)
    .limit(1)
    .maybeSingle();
  const token = parent?.fcm_push_token?.trim();
  if (!token) {
    await admin.from("notification_logs").insert({ ...baseLog, status: "no_token", error_message: null, latency_ms: Date.now() - startedAt });
    return "no_token";
  }

  try {
    await sendFcmNotification({
      token,
      title: "New learner assessment",
      body: "A new school assessment record is available. Open ClassPulse to view it.",
      data: {
        notification_type: "learner_assessment",
        student_id: assessment.student_id,
        assessment_domain: assessment.domain,
        assessment_period: assessment.assessment_period,
      },
    });
  } catch (error) {
    const stale = isStaleFcmTokenError(error);
    if (stale) {
      await admin.from("parents").update({ fcm_push_token: null }).eq("id", parent.id).eq("fcm_push_token", token);
    }
    await admin.from("notification_logs").insert({
      ...baseLog,
      status: stale ? "no_token" : "failed",
      fcm_token_preview: token.slice(-8),
      error_message: stale ? "Device token expired; parent must reopen the app" : (error instanceof Error ? error.message : String(error)).slice(0, 500),
      latency_ms: Date.now() - startedAt,
    });
    if (stale && error instanceof Error) (error as any).staleToken = true;
    throw error;
  }

  await admin.from("notification_logs").insert({ ...baseLog, status: "delivered", fcm_token_preview: token.slice(-8), error_message: null, latency_ms: Date.now() - startedAt });
  return "delivered";
}
