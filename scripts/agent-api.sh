#!/usr/bin/env bash
# The claw1 side of the agent API (marcus m60835; docs/agent-api.md). Copy to claw1; needs bash,
# curl and sha256sum. Nothing here prints the token.
#
#   agent-api.sh trial plan|execute --user <uuid|email> --days <1-90> --feeds <london,ny,...> [--attempt N]
#   agent-api.sh feed  plan|execute --user <uuid|email> --tier <tier_key> [--attempt N]
#   agent-api.sh token-hash     the sha256 of the token file, for coxwell's AGENT_API_TOKEN_SHA256
#
# Token: AGENT_API_TOKEN_FILE (default ~/.config/horizon/agent-api-token), owned by you, mode 0600,
# one line of >= 32 characters from [A-Za-z0-9+/=_-]. curl reads it from stdin (--config -), so it
# never appears in argv or in ps.
# Base URL: AGENT_API_BASE (default https://portal.horizonhft.com).
#
# The idempotency key is derived, never random (fable C4): sha256 of route + target + params + the
# UTC date (+ attempt when N > 1). A retry of the same request on the same day sends the same key,
# so it replays and cannot grant twice. After an answer of "not_granted", send it again with
# --attempt 2 (a new key). Plan mode sends no key.
set -euo pipefail

usage() {
  sed -n '5,7p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

die() {
  echo "agent-api.sh: $*" >&2
  exit 2
}

token_file="${AGENT_API_TOKEN_FILE:-$HOME/.config/horizon/agent-api-token}"
base="${AGENT_API_BASE:-https://portal.horizonhft.com}"

read_token() {
  [[ -f "$token_file" ]] || die "no token file at $token_file"
  [[ "$(stat -c %u "$token_file")" == "$(id -u)" ]] || die "$token_file is not owned by you"
  [[ "$(stat -c %a "$token_file")" == "600" ]] || die "$token_file must be mode 600 (chmod 600 $token_file)"
  local t
  t="$(<"$token_file")"
  t="${t%$'\n'}"
  [[ "$t" =~ ^[A-Za-z0-9+/=_-]{32,}$ ]] || die "$token_file does not hold a token (>= 32 chars of [A-Za-z0-9+/=_-])"
  token="$t"
}

sha256() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

[[ $# -ge 1 ]] || usage
if [[ "$1" == "token-hash" ]]; then
  read_token
  sha256 "$token"
  exit 0
fi

action="$1"
mode="${2:-}"
[[ "$action" == "trial" || "$action" == "feed" ]] || usage
[[ "$mode" == "plan" || "$mode" == "execute" ]] || usage
shift 2

user="" days="" feeds="" tier="" attempt="1"
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || die "$1 needs a value"
  case "$1" in
    --user) user="${2:-}"; shift 2 ;;
    --days) days="${2:-}"; shift 2 ;;
    --feeds) feeds="${2:-}"; shift 2 ;;
    --tier) tier="${2:-}"; shift 2 ;;
    --attempt) attempt="${2:-}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# Strict, so every value can go into the JSON as is: nothing here needs escaping.
user="${user,,}"
[[ "$user" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ || "$user" =~ ^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,189}$ ]] ||
  die "--user must be a uuid or a plain email"
[[ "$attempt" =~ ^[1-9][0-9]{0,2}$ ]] || die "--attempt must be a whole number"

if [[ "$action" == "trial" ]]; then
  [[ -z "$tier" ]] || die "--tier is for feed"
  [[ "$days" =~ ^[1-9][0-9]?$ && "$days" -le 90 ]] || die "--days must be 1-90"
  IFS=',' read -r -a list <<<"$feeds"
  [[ ${#list[@]} -gt 0 ]] || die "--feeds is required"
  for f in "${list[@]}"; do [[ "$f" =~ ^(futures|london|ny|crypto)$ ]] || die "unknown feed: $f"; done
  sorted="$(printf '%s\n' "${list[@]}" | sort -u | paste -sd, -)"
  [[ "$(printf '%s\n' "${list[@]}" | wc -l)" == "$(printf '%s\n' "${list[@]}" | sort -u | wc -l)" ]] || die "--feeds has duplicates"
  feeds_json="[\"${sorted//,/\",\"}\"]"
  params="days=$days|feeds=$sorted"
  fields="\"user\":\"$user\",\"days\":$days,\"feeds\":$feeds_json"
else
  [[ -z "$days" && -z "$feeds" ]] || die "--days/--feeds are for trial"
  [[ "$tier" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]] || die "--tier must be a tier_key"
  params="tier=$tier"
  fields="\"user\":\"$user\",\"tierKey\":\"$tier\""
fi

if [[ "$mode" == "execute" ]]; then
  seed="$action|$user|$params|$(date -u +%F)"
  [[ "$attempt" == "1" ]] || seed="$seed|attempt=$attempt"
  key="$(sha256 "$seed")"
  body="{\"mode\":\"execute\",\"idempotencyKey\":\"$key\",$fields}"
  echo "idempotencyKey: ${key:0:8}... (from: $seed)" >&2
else
  body="{\"mode\":\"plan\",$fields}"
fi

read_token
out="$(
  printf 'header = "Authorization: Bearer %s"\n' "$token" |
    curl --config - --silent --show-error --proto '=https' --max-time 75 \
      -X POST -H 'content-type: application/json' --data-binary "$body" \
      -w '\n%{http_code}' "$base/api/agent/$action"
)"
unset token
status="${out##*$'\n'}"
echo "${out%$'\n'*}"
echo "HTTP $status" >&2
[[ "$status" == 2* ]]
