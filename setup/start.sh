#!/bin/sh
# The container's start: unpack the installers if not done yet, then the multiplayer host and the page's server.
set -eu
sh /app/setup/install.sh
mkdir -p /state/rooms /state/saves /state/l10n /state/cache /state/limits
echo "Heroes Everywhere is up: http://localhost:${PORT:-8080}  (languages and what your installers cover: http://localhost:${PORT:-8080}/setup)"
cd /app/packages/client
node ../host/src/main.ts &
exec node serve.ts
