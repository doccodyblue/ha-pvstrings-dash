#!/bin/bash
# Deploy pvstrings-dash.js to the HA instance and cache-bust the resource.
#
# Two modes:
#   dev  (default): the Lovelace resource points at this Mac
#                   (tools/serve.mjs); this script only bumps ?v= so HA's
#                   frontend re-fetches the module.
#   www:            copies the file to /config/www via scp (needs SSH keys)
#                   and bumps ?v= on the /local/ resource.
#
# Usage: ./deploy.sh [dev|www]
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-dev}"
V="$(date +%s)"

node --check pvstrings-dash.js

if [ "$MODE" = "www" ]; then
  scp -q pvstrings-dash.js root@homeassistant.local:/config/www/pvstrings-dash.js
  MATCH="/local/pvstrings-dash.js"
else
  MATCH="pvstrings-dash.js"
fi

# find the resource id (lovelace/resources/update requires it)
RES=$(node tools/ha-ws.mjs '{"type":"lovelace/resources"}')
ID=$(echo "$RES" | python3 -c "
import sys, json
r = json.loads(sys.stdin.readline())
for item in r['result']:
    if '$MATCH' in item['url']:
        print(item['id']); break
")
if [ -z "$ID" ]; then
  echo "no matching Lovelace resource found (create it first)"; exit 1
fi
URL=$(echo "$RES" | python3 -c "
import sys, json
r = json.loads(sys.stdin.readline())
for item in r['result']:
    if '$MATCH' in item['url']:
        print(item['url'].split('?')[0]); break
")
node tools/ha-ws.mjs "{\"type\":\"lovelace/resources/update\",\"resource_id\":\"$ID\",\"res_type\":\"module\",\"url\":\"$URL?v=$V\"}" > /dev/null
echo "deployed ($MODE): $URL?v=$V"
