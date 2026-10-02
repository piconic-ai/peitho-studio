#!/bin/sh
set -eu

# Existing Workers Builds branches can retain the old `bun run preview`
# command even after Previews Base is updated. Never start a dev server there.
if [ "${WORKERS_CI:-}" = "1" ]; then
  echo 'Workers Builds invoked preview; forwarding to deploy:preview.'
  exec bun run deploy:preview
fi

bun run build
exec bunx --no-install wrangler dev "$@"
