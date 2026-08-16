-- Reclassify historical permanent FCM token failures without touching a token
-- that may have been refreshed since the original delivery attempt.
update public.notification_logs
set status = 'stale_token',
    error_message = 'Device token expired. The parent must reopen the app to register a new token.'
where status = 'failed'
  and (
    lower(coalesce(error_message, '')) like '%notregistered%'
    or lower(coalesce(error_message, '')) like '%not registered%'
    or lower(coalesce(error_message, '')) like '%unregistered%'
    or lower(coalesce(error_message, '')) like '%registration-token-not-registered%'
    or lower(coalesce(error_message, '')) like '%requested entity was not found%'
    or lower(coalesce(error_message, '')) like '%invalid registration token%'
  );

update public.reliability_jobs job
set status = 'cancelled',
    last_error = 'Device token expired. Waiting for the parent app to register a new token.',
    next_attempt_at = null,
    updated_at = now()
where job.status in ('queued', 'failed')
  and exists (
    select 1 from public.notification_logs log
    where log.id::text = job.payload->>'notification_log_id'
      and log.status = 'stale_token'
  );
