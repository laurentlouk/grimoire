echo "WRITER ok"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
dec() { base64 --decode < "$1.b64" > "$1" 2>/dev/null || openssl base64 -d < "$1.b64" > "$1" 2>/dev/null; rm -f "$1.b64"
  CK=$(cksum < "$1" 2>/dev/null | awk '{ print $1 "/" $2 }'); GOT=$(wc -c < "$1" | tr -d ' '); [ -n "$CK" ] || CK="-/$GOT"
  if [ "$CK" = "$2/$3" ] || [ "$CK" = "-/$3" ]; then OK=1; else OK=0; rm -f "$1"; fi; }
L="$DIR/.lock"; B="$DIR/.lock.brk"; HELD=0; LS=${GRIMOIRE_LOCK_STALE:-30}; case "$LS" in ''|*[!0-9]*) LS=30 ;; esac; [ "$LS" -ge 1 ] || LS=1
now() { _n=$(date +%s 2>/dev/null); case "$_n" in ''|*[!0-9]*) _n=0 ;; esac; echo "$_n"; }
NAPS=1; sleep 0.01 2>/dev/null && NAPS=20; I=0; CLK=1; [ "$(now)" = 0 ] && CLK=0
nap() { I=$((I + 1)); sleep 0.05 2>/dev/null || sleep 1; }
tick() { if [ "$CLK" = 1 ]; then now; else echo $((I / NAPS)); fi; } # seconds: the clock, or the naps taken where date +%s does not work
brk() { mkdir "$B" 2>/dev/null || return 1; echo $$ > "$B/pid"; }
staleb() { _q=$(cat "$B/pid" 2>/dev/null)
  if [ -n "$_q" ]; then BT=; kill -0 "$_q" 2>/dev/null || { [ "$(cat "$B/pid" 2>/dev/null)" = "$_q" ] && rm -rf "$B"; }
  else _n=$(tick); if [ -z "$BT" ]; then BT=$_n; elif [ $((_n - BT)) -ge 5 ]; then nap; [ -z "$(cat "$B/pid" 2>/dev/null)" ] && rm -rf "$B"; BT=; fi; fi; }
unlock() { [ "$HELD" = 1 ] || return 0; HELD=0; _g=0; _u=$(tick)
  while :; do if brk; then _g=1; break; fi; staleb; [ $(($(tick) - _u)) -ge 5 ] && break; nap; done
  [ "$(cat "$L/pid" 2>/dev/null)" = "$$" ] && rm -rf "$L"; [ "$_g" = 1 ] && rm -rf "$B"; return 0; }
trap unlock EXIT
T0=$(tick); TS=$T0; LN=$T0; SEEN=-; BT=
while :; do
  N=$(tick); [ $((N - LN)) -gt 5 ] && { TS=$((TS + N - LN)); T0=$((T0 + N - LN)); }; LN=$N
  if brk; then
    BT=
    if [ -d "$L" ]; then
      P=$(cat "$L/pid" 2>/dev/null)
      [ "$P" = "$SEEN" ] || { SEEN=$P; TS=$N; }
      if { [ -n "$P" ] && ! kill -0 "$P" 2>/dev/null; } || [ $((N - TS)) -ge "$LS" ]; then [ "$(cat "$L/pid" 2>/dev/null)" = "$P" ] && rm -rf "$L"; fi
    fi
    mkdir "$L" 2>/dev/null && { echo $$ > "$L/pid"; HELD=1; }
    rm -rf "$B"
    [ "$HELD" = 1 ] && break
  else staleb
  fi
  N=$(tick); [ $((N - T0)) -ge $((LS * 2)) ] && break
  [ "$I" -ge $((LS * 6 * NAPS)) ] && break
  nap
done
PREV=$(sed -n 's/^{"runId":[^,]*,"attempt":\([0-9][0-9]*\).*/\1/p' "$DIR/run.json" 2>/dev/null | head -n 1)
[ -n "$PREV" ] || { [ -f "$DIR/run.json" ] && PREV=1; }
ATTEMPT=$(sed -n "s/^$SESSION \([0-9][0-9]*\)\$/\1/p" "$DIR/sessions" 2>/dev/null | head -n 1)
if [ -z "$ATTEMPT" ]; then
  TOP=$(awk '$2 + 0 > m { m = $2 + 0 } END { print m + 0 }' "$DIR/sessions" 2>/dev/null); [ "${TOP:-0}" -ge "${PREV:-0}" ] || TOP=$PREV
  ATTEMPT=$((${TOP:-0} + 1)); [ "$ATTEMPT" -ge "$SEED" ] || ATTEMPT=$SEED
  echo "$SESSION $ATTEMPT" >> "$DIR/sessions"
fi
GEN=$ATTEMPT; [ "$SEED" -gt 0 ] && GEN=$SEED
if [ -n "$CHUNK" ]; then
F="$DIR/events/$CHUNK.jsonl"
[ "$ATTEMPT" -gt 1 ] && F="$DIR/events/$CHUNK.a$ATTEMPT.jsonl"
T="$DIR/.chunk.$$"; dec "$T" "$CK_C" "$N_C"
if [ "$OK" = 1 ]; then echo "LINES $(wc -l < "$T" | tr -d ' ')"; echo "BYTES $(wc -c < "$T" | tr -d ' ')"; sed -e "s/__AT__/$NOW/g" -e "s/\"__ATTEMPT__\"/$ATTEMPT/g" "$T" > "$T.s" && mv -f "$T.s" "$F"
else echo "LINES 0"; echo "BYTES ${GOT:-0}"; echo "CHUNK bad: not written"; fi
rm -f "$T" "$T.s"
else echo "LINES 0"; echo "BYTES 0"; fi
if [ -n "$CK_R" ]; then
STARTED=$(sed -n 's/.*"startedAt": *"\([^"]*\)".*/\1/p' "$DIR/run.json" 2>/dev/null | head -n 1)
case "$STARTED" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z) ;; *) STARTED=$NOW ;; esac
OLDGEN=$(sed -n 's/^{"runId":[^,]*,"attempt":[0-9]*,"gen":\([0-9][0-9]*\),.*/\1/p' "$DIR/run.json" 2>/dev/null | head -n 1)
[ -n "$OLDGEN" ] || OLDGEN=${PREV:-0}
OLDSEQ=$(sed -n 's/.*"lastSeq":\([0-9][0-9]*\).*/\1/p' "$DIR/run.json" 2>/dev/null | head -n 1)
if [ "$GEN" -gt "$OLDGEN" ] || { [ "$GEN" -eq "$OLDGEN" ] && [ "${OLDSEQ:-0}" -le "$NEWSEQ" ]; }; then
T="$DIR/.runjson.$$"; dec "$T" "$CK_R" "$N_R"
if [ "$OK" = 1 ]; then echo "RUNJSON_BYTES $(wc -c < "$T" | tr -d ' ')"
  if sed -e "s/__AT__/$NOW/g" -e "s/\"__ATTEMPT__\"/$ATTEMPT/g" -e "s/__STARTED__/$STARTED/g" -e "s/\"__GEN__\"/$GEN/" "$T" > "$T.s" && [ -s "$T.s" ] && mv -f "$T.s" "$DIR/run.json"; then echo "RUNJSON ok"; else echo "RUNJSON bad: not written, the one on disk is unchanged"; fi
else echo "RUNJSON_BYTES ${GOT:-0}"; echo "RUNJSON bad: the payload did not decode to what was sent, the one on disk is unchanged"; fi
rm -f "$T" "$T.s"
else echo "RUNJSON kept: gen $OLDGEN seq ${OLDSEQ:-0} on disk is newer than gen $GEN seq $NEWSEQ"; fi
else echo "RUNJSON kept: not sent with this script"; fi
if [ -n "$CK_L" ]; then
T="$DIR/.landed.$$"; dec "$T" "$CK_L" "$N_L"
if [ "$OK" = 1 ] && sed -e "s/^{\"attempt\":\"__ATTEMPT__\",\"at\":\"__AT__\",/{\"attempt\":$ATTEMPT,\"at\":\"$NOW\",/" "$T" > "$T.s" && LJ="$DIR/landed.jsonl" awk 'BEGIN { F = ENVIRON["LJ"]; while ((getline l < F) > 0) if (match(l, /"k":"[0-9a-f]+"/)) s[substr(l, RSTART, RLENGTH)] = 1 } { if (match($0, /"k":"[0-9a-f]+"/)) { k = substr($0, RSTART, RLENGTH); if (k in s) next; s[k] = 1 } print }' "$T.s" > "$T.d" && cat "$T.d" >> "$DIR/landed.jsonl"; then echo "LANDED ok $(wc -l < "$T" | tr -d ' ')"; else echo "LANDED bad"; fi
rm -f "$T" "$T.s" "$T.d"
fi
rm -f "$DIR/.chunk.$$.b64" "$DIR/.runjson.$$.b64" "$DIR/.landed.$$.b64"
unlock
echo "RUNDIR $DIR"
