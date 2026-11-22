#!/usr/bin/env bash
# Restart local Auth so it fetches the custom email templates again.
# `supabase start` can bring Auth up before the gateway serves the templates on port 8088; Auth then
# keeps the default "Reset your password" and "You've been invited" emails (RUNBOOK trap 28). Run
# after `supabase start`.
set -euo pipefail

container="supabase_auth_enjoy-card-app"
docker restart "$container" >/dev/null
started=$(docker inspect -f '{{.State.StartedAt}}' "$container")

for _ in $(seq 1 60); do
  logs=$(docker logs --since "$started" "$container" 2>&1)
  if grep -q 'templatemailer_template_body_http_error' <<<"$logs"; then
    echo "Auth could not fetch an email template:" >&2
    grep 'templatemailer_template_body_http_error' <<<"$logs" >&2
    exit 1
  fi
  if grep -q "reloaded template type: recovery" <<<"$logs" &&
    grep -q "reloaded template type: invite" <<<"$logs" &&
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = healthy ]; then
    echo "Auth reloaded the email templates."
    exit 0
  fi
  sleep 1
done

echo "Auth did not reload the recovery and invite templates within 60 seconds." >&2
exit 1
