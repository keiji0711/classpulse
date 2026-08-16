import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

interface InterventionPayload {
  intervention_id: string;
  student_id: string;
  school_id: string;
  created_by: string;
  action_type: string;
  notes: string;
}

export async function notifyInterventionCreated(payload: InterventionPayload) {
  try {
    // Get student info
    const { data: student, error: stuError } = await supabase
      .from("students")
      .select("first_name, last_name, section_id")
      .eq("id", payload.student_id)
      .single();

    if (stuError || !student) {
      console.error("Failed to fetch student:", stuError);
      return;
    }

    // Get parents' push tokens
    const { data: parents, error: parentsError } = await supabase
      .from("parents")
      .select("fcm_push_token, expo_push_token")
      .eq("student_id", payload.student_id);

    if (parentsError) {
      console.error("Failed to fetch parents:", parentsError);
      return;
    }

    if (!parents || parents.length === 0) {
      console.log("No parents found for student");
      return;
    }

    const actionLabel = payload.action_type
      .replace(/_/g, " ")
      .toUpperCase();
    const studentName = `${student.first_name} ${student.last_name}`;

    // Send FCM push notifications
    const fcmTokens = parents
      .filter((p: any) => p.fcm_push_token)
      .map((p: any) => p.fcm_push_token);

    if (fcmTokens.length > 0) {
      const fcmResponse = await fetch("https://fcm.googleapis.com/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `key=${Deno.env.get("FCM_SERVER_KEY")}`,
        },
        body: JSON.stringify(
          fcmTokens.map((token: string) => ({
            to: token,
            notification: {
              title: `School Update: ${studentName}`,
              body: `${actionLabel} - ${payload.notes.substring(0, 50)}...`,
              sound: "default",
            },
            data: {
              type: "intervention",
              intervention_id: payload.intervention_id,
              student_id: payload.student_id,
            },
          }))
        ),
      });

      console.log("FCM response:", fcmResponse.status);
    }

    // Log in email_logs table for audit
    await supabase.from("email_logs").insert({
      school_id: payload.school_id,
      recipient_type: "parent",
      recipient_count: parents.length,
      message_type: "intervention_notification",
      status: "sent",
      details: {
        student_id: payload.student_id,
        action_type: payload.action_type,
        preview: payload.notes.substring(0, 100),
      },
    });

    console.log(`Sent intervention notification to ${parents.length} parent(s)`);
  } catch (error) {
    console.error("Error in notifyInterventionCreated:", error);
  }
}
