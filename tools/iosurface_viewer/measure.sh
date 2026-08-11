#!/bin/bash
# Sample the video pipeline's cost, so before and after are measured the same way.
#
# Averages over a window rather than taking one reading: `ps` reports CPU as an
# average since process start, so a single sample tells you about the whole
# session rather than about now. Sampling the delta over N seconds is what
# actually reflects the current path.
#
#   ./measure.sh [seconds] [label]
#
# Compare like with like: same window size, same character on screen, same
# resolution, stream running and visible in both runs.

SECS="${1:-20}"
LABEL="${2:-baseline}"
OUT="${TMPDIR:-/tmp}/unclaw_measure_${LABEL}.txt"

pids_for() { pgrep -f "$1" 2>/dev/null | tr '\n' ' '; }

sum_rss() {  # MB
  local t=0
  for p in $1; do
    r=$(ps -o rss= -p "$p" 2>/dev/null | tr -d ' ')
    [ -n "$r" ] && t=$((t + r))
  done
  echo $((t / 1024))
}

# CPU as a delta: total jiffies used across the window, divided by the window.
cpu_time_total() {  # seconds of CPU consumed, summed
  local t=0
  for p in $1; do
    s=$(ps -o time= -p "$p" 2>/dev/null | tr -d ' ')
    [ -z "$s" ] && continue
    IFS=':' read -r a b c <<< "$s"
    if [ -n "$c" ]; then v=$(echo "$a*3600 + $b*60 + $c" | bc)
    else                 v=$(echo "${a:-0}*60 + ${b:-0}" | bc); fi
    t=$(echo "$t + $v" | bc)
  done
  echo "$t"
}

ELE=$(pids_for "UnClaw/node_modules/electron/dist/Electron.app")
UE=$(pids_for "Unclaw Character.app/Contents/MacOS")
[ -z "$ELE" ] && ELE=$(pids_for "/Applications/Unclaw.app/Contents/MacOS")

if [ -z "$ELE" ] || [ -z "$UE" ]; then
  echo "need both the app and Unreal running with the stream visible"
  echo "  electron pids: ${ELE:-none}"
  echo "  unreal pids  : ${UE:-none}"
  exit 1
fi

# GPU: system-wide, from IOKit's AGXAccelerator statistics. No sudo needed,
# unlike powermetrics. It covers the whole GPU rather than one process, which
# is what we want here: Unreal plus the window server compositing is exactly
# the cost the direct path is meant to change.
gpu_stats() {  # "utilization renderer tiler inuse_bytes"
  ioreg -r -d 1 -w 0 -c AGXAccelerator 2>/dev/null | tr ',' '\n' | awk -F'=' '
    /"Device Utilization %"/   {u=$2}
    /"Renderer Utilization %"/ {r=$2}
    /"Tiler Utilization %"/    {t=$2}
    /"In use system memory"=/  {m=$2}
    END { gsub(/[^0-9]/,"",u); gsub(/[^0-9]/,"",r);
          gsub(/[^0-9]/,"",t); gsub(/[^0-9]/,"",m);
          print (u==""?0:u), (r==""?0:r), (t==""?0:t), (m==""?0:m) }'
}

e0=$(cpu_time_total "$ELE"); u0=$(cpu_time_total "$UE")
read g0 r0 t0 m0 <<< "$(gpu_stats)"

# Average GPU utilisation across the window: a single reading is whatever the
# GPU happened to be doing in that instant.
gsum=0; rsum=0; tsum=0; n=0
end=$(( $(date +%s) + SECS ))
while [ "$(date +%s)" -lt "$end" ]; do
  read gu ru tu mu <<< "$(gpu_stats)"
  gsum=$((gsum + gu)); rsum=$((rsum + ru)); tsum=$((tsum + tu)); n=$((n + 1))
  sleep 1
done
read g1 r1 t1 m1 <<< "$(gpu_stats)"

e1=$(cpu_time_total "$ELE"); u1=$(cpu_time_total "$UE")

eCPU=$(echo "scale=1; ($e1 - $e0) * 100 / $SECS" | bc)
uCPU=$(echo "scale=1; ($u1 - $u0) * 100 / $SECS" | bc)
eRSS=$(sum_rss "$ELE"); uRSS=$(sum_rss "$UE")

{
  echo "label        : $LABEL"
  echo "window       : ${SECS}s"
  echo "when         : $(date '+%Y-%m-%d %H:%M:%S')"
  echo "electron pids: $(echo $ELE | wc -w | tr -d ' ')"
  printf "electron     : %6s MB   %6s%% CPU\n" "$eRSS" "$eCPU"
  printf "unreal       : %6s MB   %6s%% CPU\n" "$uRSS" "$uCPU"
  printf "TOTAL        : %6s MB   %6s%% CPU\n" \
    "$((eRSS + uRSS))" "$(echo "$eCPU + $uCPU" | bc)"
  echo "---- gpu (system-wide, $n samples) ----"
  printf "gpu util     : %6s%%  (renderer %s%%, tiler %s%%)\n" \
    "$((gsum / (n > 0 ? n : 1)))" "$((rsum / (n > 0 ? n : 1)))" "$((tsum / (n > 0 ? n : 1)))"
  printf "gpu memory   : %6s MB in use\n" "$((m1 / 1048576))"
} | tee "$OUT"
echo
echo "saved: $OUT"
