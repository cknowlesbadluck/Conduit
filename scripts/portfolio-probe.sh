#!/usr/bin/env bash
# Portfolio live probe for Quicksilver / Resonance / Conduit
# Fail-closed: exits non-zero if any critical endpoint is not 200 ready.
set -euo pipefail

echo "=== Portfolio Probe $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

probe() {
  local name="$1" url="$2"
  local code
  code=$(curl -s -o /tmp/probe-body.json -w "%{http_code}" --max-time 10 "$url" || echo "000")
  echo "$name: $code"
  if [[ "$code" != "200" ]]; then
    echo "  body: $(head -c 200 /tmp/probe-body.json 2>/dev/null || echo 'n/a')"
    return 1
  fi
  return 0
}

fail=0
probe "Conduit /ready" "https://conduit-feco.onrender.com/ready" || fail=1
probe "Resonance /api/ready" "https://resonancenexus.netlify.app/api/ready" || fail=1
# Quicksilver is device-side; no public ready endpoint. Device HG on iPhone 16e remains the product gate.

if [[ $fail -eq 0 ]]; then
  echo "All probed surfaces 200."
else
  echo "One or more surfaces not ready. Owner action required for Resonance SERVICE_ROLE_KEY."
  exit 1
fi
