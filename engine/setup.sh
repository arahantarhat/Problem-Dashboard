#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
revision=0e2f38f759cc830849e489307f3d256a7d148288
if [ ! -d .engine/bend/.git ]; then
  mkdir -p .engine
  git init .engine/bend
  git -C .engine/bend remote add origin https://github.com/bendlang/bend.git
  git -C .engine/bend fetch --depth 1 origin "$revision"
  git -C .engine/bend checkout --detach FETCH_HEAD
fi
test "$(git -C .engine/bend rev-parse HEAD)" = "$revision"
if ! command -v bun >/dev/null 2>&1 && [ ! -x .engine/runtime/node_modules/.bin/bun ]; then
  npm install --prefix .engine/runtime --no-audit --no-fund bun@1.4.5
fi
node engine/build.mjs
