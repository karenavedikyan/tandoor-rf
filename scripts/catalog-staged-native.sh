#!/bin/sh
# FD 3 is the already-locked PostgreSQL session. No Node process remains resident.
set -eu
umask 077
d=$1
parent=$2
TMPDIR=$d
export TMPDIR
child=
cg=/sys/fs/cgroup
if [ ! -r "$cg/memory.current" ]; then
  relative=$(awk -F: '$1=="0"{print $3}' /proc/self/cgroup)
  cg="/sys/fs/cgroup$relative"
fi
[ -r "$cg/memory.current" ] || exit 94
finish() {
  code=$?
  trap - EXIT INT TERM
  if [ -n "$child" ]; then kill -KILL "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; fi
  exec 3<&-
  printf '%s\n' "$code" > "$d/native.done"
  exit "$code"
}
trap finish EXIT
trap 'exit 91' INT TERM
available() {
  host=$(awk '/^MemAvailable:/{printf "%.0f",$2*1024}' /proc/meminfo)
  case "$host" in ''|*[!0-9]*) return 1;; esac
  for name in max high; do
    raw=$(cat "$cg/memory.$name")
    if [ "$raw" != max ]; then
      current=$(cat "$cg/memory.current")
      rest=$(awk -v max="$raw" -v used="$current" 'BEGIN{
        if(max !~ /^[0-9]+$/ || used !~ /^[0-9]+$/) exit 1; printf "%.0f",max-used
      }') || return 1
      [ "$rest" -ge "$host" ] || host=$rest
    fi
  done
  printf '%s\n' "$host"
}
# Parent exit releases V8/Sharp/pg memory; the inherited socket retains leases.
i=0
while [ -r "/proc/$parent/status" ] && [ "$(awk '/^VmRSS:/{print $2}' "/proc/$parent/status")" != '' ]; do
  i=$((i+1)); [ "$i" -lt 100 ] || exit 92
  sleep 0.01
done
needed=$(cat "$d/native.require")
a=$(available)
[ "$a" -ge "$needed" ] || { echo "PHOTO_STAGED_NATIVE_NO_MEMORY $a $needed"; exit 93; }
[ "$(awk '/^oom_kill /{print $2}' "$cg/memory.events")" = 0 ] || exit 94
wget -q -T 2 -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/ready" || exit 95
"$d/jpegtran-disk-x86_64" -copy all -strict -maxmemory 64m < "$d/source" > "$d/normalized" 2> "$d/native.stderr" &
child=$!
started=$(date +%s)
peak=0
minimum=$a
checks=0
while kill -0 "$child" 2>/dev/null; do
  a=$(available) || exit 94
  rss=$(awk '/^VmRSS:/{print $2}' "/proc/$child/status" 2>/dev/null || true)
  rss=${rss:-0}
  [ "$rss" -le "$peak" ] || peak=$rss
  [ "$a" -ge "$minimum" ] || minimum=$a
  [ "$a" -ge 100663296 ] && [ "$rss" -le 196608 ] || exit 94
  [ "$(awk '/^oom_kill /{print $2}' "$cg/memory.events")" = 0 ] || exit 94
  [ "$(wc -c < "$d/normalized")" -le 67108864 ] || exit 96
  [ "$(wc -c < "$d/native.stderr")" -le 4096 ] || exit 96
  [ "$(($(date +%s)-started))" -lt 10 ] || exit 97
  checks=$((checks+1))
  if [ "$((checks%50))" = 0 ]; then
    wget -q -T 2 -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/ready" || exit 95
  fi
  sleep 0.02
done
wait "$child"
child=
[ -s "$d/normalized" ] && [ ! -s "$d/native.stderr" ] || exit 98
[ "$(wc -c < "$d/normalized")" -le 67108864 ] || exit 96
wget -q -T 2 -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/ready" || exit 95
echo "PHOTO_STAGED_NATIVE_OK rssKiB=$peak minAvailableBytes=$minimum"
