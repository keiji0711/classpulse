import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasAdminMfa } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the calling user is authenticated and authorized
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller's identity and role
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
      }
    );

    const {
      data: { user: caller },
      error: callerAuthError,
    } = await supabaseAuth.auth.getUser();

    if (callerAuthError || !caller) {
      return new Response(
        JSON.stringify({ error: callerAuthError?.message || "Invalid or expired session" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (!hasAdminMfa(req)) {
      return new Response(JSON.stringify({ error: "MFA verification is required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get caller's role from public.users
    const { data: callerProfile } = await supabaseAdmin
      .from("users")
      .select("role, school_id, is_platform_owner")
      .eq("id", caller.id)
      .single();

    if (!callerProfile) {
      return new Response(JSON.stringify({ error: "Caller profile not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, password, full_name, role, school_id, phone_number, address } = await req.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedFullName = typeof full_name === "string" ? full_name.trim() : "";

    if (!normalizedEmail || !password || !normalizedFullName || !role) {
      return new Response(
        JSON.stringify({ error: "Email, password, full name, and role are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (role !== "super_admin" && !school_id) {
      return new Response(
        JSON.stringify({ error: "Please assign the user to a school before creating the account" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: existingProfile } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingProfile) {
      return new Response(
        JSON.stringify({ error: "That email is already being used by another account." }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Authorization checks
    if (callerProfile.role === "super_admin") {
      if (!callerProfile.is_platform_owner) {
        return new Response(JSON.stringify({ error: "Only a platform owner can create school administrators" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Super admin can create school_admin users
      if (role !== "school_admin") {
        return new Response(
          JSON.stringify({ error: "Super admin can only create school admins" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else if (callerProfile.role === "school_admin") {
      // School admin can only create instructors in their own school
      if (role !== "instructor") {
        return new Response(
          JSON.stringify({ error: "School admin can only create teachers" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (school_id !== callerProfile.school_id) {
        return new Response(
          JSON.stringify({ error: "Cannot create users for another school" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create auth user using admin API (does NOT affect caller's session)
    const { data: newUser, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
      });

    if (createError) {
      const friendlyMessage = createError.message.toLowerCase().includes("already")
        ? "That email is already registered. Please use a different email."
        : createError.message;

      return new Response(JSON.stringify({ error: friendlyMessage }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert into public.users
    const { error: insertError } = await supabaseAdmin.from("users").insert({
      id: newUser.user.id,
      email: normalizedEmail,
      role,
      school_id,
      full_name: normalizedFullName,
      phone_number: phone_number || '',
      address: address || '',
    });

    if (insertError) {
      // Rollback: delete the auth user if profile insert fails
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ user: { id: newUser.user.id, email: normalizedEmail, role, school_id, full_name: normalizedFullName, phone_number, address } }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
