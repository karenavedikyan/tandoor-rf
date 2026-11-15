#!/bin/sh
# Must be spawned with detached:true: $$ is this job's private process group.
# A hard deadline and every exit clean up only this group, never the app server.
set -u
umask 077
d=$1
finish() {
  code=$?
  trap - EXIT INT TERM HUP
  trap '' TERM
  echo "PHOTO_STAGED_PROCESS_EXIT $code"
  kill -TERM "-$$" 2>/dev/null || true
  rm -f "$d/source" "$d/normalized" "$d/item.json" "$d/native.done" "$d/native.require" "$d/native.stderr"
  exit "$code"
}
trap finish EXIT
trap 'exit 99' INT TERM
trap '' HUP
( sleep 2140; echo PHOTO_STAGED_HARD_DEADLINE; kill -TERM "-$$" ) &
/bin/sh "$d/catalog-staged-photos.sh" "$d"
exit $?
