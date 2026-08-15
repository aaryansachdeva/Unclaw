#!/bin/bash
# Measure Unreal's heap growth the same way on any build, so Development and
# Shipping numbers can actually be compared.
#
#   ./leakslope.sh [minutes] [label]      # default 6 minutes
#
# Why MALLOC_SMALL and not RSS or Activity Monitor: the leak is CPU-side heap in
# the small-allocation zone. RSS lags it, and Activity Monitor's figure folds in
# GPU allocations that move with render resolution, which swamps the signal the
# moment the window is a different size between two runs.
#
# Measured on Development 2026.0811.04, 1182x1536, 24fps: +15.8 MB/min, linear.
# If Shipping reads near zero, the leak is Development-only instrumentation
# (Metal resource debug labels) and never reaches users.

MINS="${1:-6}"
LABEL="${2:-$(sw_vers -productVersion)}"

# Matches the raw editor output (AudioTestProject02*.app) AND the carved,
# re-branded bundle ("Unclaw Character.app"), which is what actually ships.
UE=$(pgrep -f "Unclaw Character.app/Contents/MacOS" | head -1)
[ -z "$UE" ] && UE=$(pgrep -f "AudioTestProject02[^ ]*.app/Contents/MacOS" | head -1)
if [ -z "$UE" ]; then
  echo "no Unreal process found — start the app with the stream visible first"
  exit 1
fi

# Same character, same window size, stream actually visible, or the comparison
# is meaningless.
echo "pid       : $UE"
echo "uptime    : $(ps -o etime= -p "$UE" | tr -d ' ')"
echo "label     : $LABEL"
echo "window    : ${MINS} min"
echo

# Physical footprint, NOT the resident column. Under memory pressure macOS
# compresses pages out of a process: resident falls while the allocation is
# still very much alive and still charged to it. Reading resident alone makes a
# steady leak look like a sawtooth that keeps "collecting" itself (misread that
# way on 2026-08-11: MALLOC_SMALL appeared to drop 205 -> 83 MB, when in truth
# it was 127 MB resident plus 513 MB swapped and still growing). Physical
# footprint counts compressed pages, which is also the number Activity Monitor
# shows, so this matches what you see there.
read_ms() {   # physical footprint, in MB
  vmmap --summary "$UE" 2>/dev/null | awk '/Physical footprint:/{
    v=$3; u=substr(v,length(v),1); gsub(/[KMG]/,"",v)
    if (u=="G") v*=1024; else if (u=="K") v/=1024
    printf "%.1f", v; exit }'
}

first=""; last=""
for i in $(seq 0 "$MINS"); do
  ms=$(read_ms)
  [ -z "$first" ] && first="$ms"
  last="$ms"
  printf "t=+%-2dm  footprint=%8s MB\n" "$i" "$ms"
  [ "$i" -lt "$MINS" ] && sleep 60
done

echo
echo "$(echo "scale=2; ($last - $first) / $MINS" | bc) MB/min" \
     " => $(echo "scale=2; ($last - $first) * 60 / $MINS / 1024" | bc) GB/hour"
