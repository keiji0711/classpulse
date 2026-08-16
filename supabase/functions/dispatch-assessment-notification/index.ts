import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { isValidUUID } from "../_shared/validation.ts";
import { processLearnerAssessmentPush } from "../_shared/assessmentNotification.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyAuth(req);
  if (auth.error || !auth.user) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401, headers });
  }

  try {
    const { assessment_id } = await req.json();
    if (!isValidUUID(assessment_id)) {
      return new Response(JSON.stringify({ error: "Valid assessment_id is required" }), { status: 400, headers });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: assessment } = await admin
      .from("learner_assessments")
      .select("id,assessed_by")
      .eq("id", assessment_id)
      .maybeSingle();
    if (!assessment || assessment.assessed_by !== auth.user.id) {
      return new Response(JSON.stringify({ error: "Not authorized for this assessment" }), { status: 403, headers });
    }

    const { data: queuedJob } = await admin
      .from("reliability_jobs")
      .select("*")
      .eq("job_type", "learner_assessment_push")
      .eq("payload->>assessment_id", assessment_id)
      .in("status", ["queued", "failed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // No job means this insert was grouped with an earlier notification, or
    // this was a correction to an existing record. Both cases are intentional.
    if (!queuedJob) {
      return new Response(JSON.stringify({ success: true, deduplicated: true }), { status: 200, headers });
    }

    const { data: job } = await admin
      .from("reliability_jobs")
      .update({ status: "running", attempts: queuedJob.attempts + 1, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", queuedJob.id)
      .in("status", ["queued", "failed"])
      .select("*")
      .maybeSingle();
    if (!job) {
      return new Response(JSON.stringify({ success: true, already_processing: true }), { status: 200, headers });
    }

    try {
      const delivery = await processLearnerAssessmentPush(admin, job);
      await admin.from("reliability_jobs").update({ status: "completed", completed_at: new Date().toISOString(), last_error: null, next_attempt_at: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      return new Response(JSON.stringify({ success: true, delivery }), { status: 200, headers });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      const stale = Boolean((error as any)?.staleToken);
      const exhausted = job.attempts >= job.max_attempts;
      await admin.from("reliability_jobs").update({
        status: stale || exhausted ? "cancelled" : "failed",
        last_error: message,
        next_attempt_at: stale || exhausted ? null : new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      return new Response(JSON.stringify({ error: "Notification queued for retry" }), { status: 503, headers });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers });
  }
});
