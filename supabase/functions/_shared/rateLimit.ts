export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function consumeParentLoginAttempt(
  supabaseAdmin: any,
  identifier: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const keyHash = await sha256(identifier.trim().toLowerCase());
  const { data, error } = await supabaseAdmin.rpc("consume_parent_auth_attempt", {
    p_key_hash: keyHash,
    p_max_attempts: 5,
    p_window_seconds: 300,
    p_block_seconds: 900,
  });
  if (error) {
    console.error("[parent-auth] Distributed rate limiter failed closed:", error.message);
    return { allowed: false, retryAfterSeconds: 60 };
  }
  const result = Array.isArray(data) ? data[0] : data;
  return {
    allowed: result?.allowed === true,
    retryAfterSeconds: Number(result?.retry_after_seconds ?? 0),
  };
}

export async function clearParentLoginAttempts(
  supabaseAdmin: any,
  identifier: string,
): Promise<void> {
  const keyHash = await sha256(identifier.trim().toLowerCase());
  const { error } = await supabaseAdmin.rpc("clear_parent_auth_attempts", {
    p_key_hash: keyHash,
  });
  if (error) console.error("[parent-auth] Failed to clear throttle:", error.message);
}
