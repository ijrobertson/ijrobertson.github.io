#!/usr/bin/env bash
# Fails loudly if the Firebase Hosting site serves any private file.
# Run after every hosting deploy (npm run deploy:pwa does this automatically).
SITE="${1:-https://linguabud-9a942.web.app}"
bad=0
for path in functions/.env functions/index.js .git/config .gitignore firestore.rules storage.rules firebase.json firebase-emulator-data/auth_export/accounts.json; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/$path?check=$RANDOM")
  if [ "$code" != "404" ]; then
    echo "EXPOSED: $SITE/$path returned $code"
    bad=1
  fi
done
if [ "$bad" = "1" ]; then
  echo "Private files are publicly reachable. Fix the hosting ignore list in firebase.json and redeploy."
  exit 1
fi
echo "OK: no private files are served by $SITE"
