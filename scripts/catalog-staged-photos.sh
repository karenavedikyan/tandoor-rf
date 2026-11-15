#!/bin/sh
# Explicit one-shot controller. Caller supplies a private config and a detached
# process group with an outer hard deadline. No scheduler or service is changed.
set -eu
umask 077
d=$1
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cleanup() {
  rm -f "$d/source" "$d/normalized" "$d/item.json" "$d/native.done" "$d/native.require" "$d/native.stderr"
}
trap cleanup EXIT
run_node() {
  node --expose-gc --max-old-space-size=64 --max-semi-space-size=1 "$here/catalog-staged-photos.cjs" "$@"
}
run_node init "$d"
count=$(cat "$d/count")
case "$count" in ''|*[!0-9]*) exit 1;; esac
[ "$count" -le 1000 ] || exit 1
i=0
started=$(date +%s)
while [ "$i" -lt "$count" ]; do
  [ "$(($(date +%s)-started))" -lt 2100 ] || exit 1
  rm -f "$d/source" "$d/normalized" "$d/item.json" "$d/native.done" "$d/native.require" "$d/native.stderr"
  run_node fetch "$d" "$i"
  if [ -f "$d/native.require" ]; then
    n=0
    while [ ! -f "$d/native.done" ]; do
      n=$((n+1)); [ "$n" -lt 350 ] || exit 1
      sleep 0.05
    done
  fi
  if [ -f "$d/native.done" ]; then
    [ "$(cat "$d/native.done")" = 0 ] || exit 1
    run_node publish "$d" "$i"
  fi
  i=$((i+1))
  [ "$i" != 3 ] || echo PHOTO_STAGED_FIRST_THREE_COMPLETE
done
run_node final "$d"
rm -f "$d/source" "$d/normalized" "$d/item.json" "$d/native.done" "$d/native.require" "$d/native.stderr"
echo PHOTO_STAGED_COMPLETE
