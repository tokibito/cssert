#!/usr/bin/env bash
# Rebuilds the "real build output" fixtures under test/fixtures/.
# Requires network access (uses npx). The generated CSS is committed so tests
# do not depend on this script.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
fx="$here/test/fixtures"

echo "== Tailwind v4"
(cd "$fx/src/tailwind-v4" && npx -y @tailwindcss/cli@4 -i input.css -o "$fx/tailwind-v4.css")

echo "== Tailwind v3"
(cd "$fx/src/tailwind-v3" && npx -y tailwindcss@3 -c tailwind.config.cjs -i input.css -o "$fx/tailwind-v3.css")

echo "== UnoCSS"
(cd "$fx/src/unocss" && npx -y -p unocss -p @unocss/cli unocss "index.html" -c uno.config.ts -o "$fx/unocss.css")

echo "done"
