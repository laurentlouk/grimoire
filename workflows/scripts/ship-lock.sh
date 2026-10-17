# grimoire · the repo's ship lock: one ship, or the gate, moves the run branch and the PR at a time.
# Sourced by the loop's ship, seal and gate scripts once its cksum is the engine's. Generated from
# SHIP_LOCK in workflows/orchestrate-loop.js by scripts/build-ship-lock.mjs: edit the engine, not this.
now() { _n=$(date +%s 2>/dev/null); case "$_n" in ''|*[!0-9]*) _n=0 ;; esac; echo "$_n"; }
lkold() { [ -n "$(find "$1" -prune ! -newer "$2" 2>/dev/null)" ]; } # <dir> <stamp>: the dir has not changed since the stamp was made
lknap() { if [ "$1" -lt 10 ] && sleep "0.$1" 2>/dev/null; then _i=$((_i + $1)); else sleep 1; _i=$((_i + 10)); fi; } # <tenths of a second>, counted for where date +%s does not work
lkmine() { _r=; { read -r _r <"$LKP.brk/pid"; } 2>/dev/null; [ "$_r" = "$$" ]; } # the mutex holds this shell's pid
lkout() { if lkmine; then rm -rf "$LKP.brk"; fi; } # leave the mutex: removed only while it is still this shell's
lkbrk() { _r=; { read -r _r <"$LKP.brk/pid"; } 2>/dev/null; _bs=; [ "$_r" = "$1" ] && { [ -z "${2:-}" ] || lkold "$LKP.brk" "$LKP.$$.b"; } && rm -rf "$LKP.brk"; } # <pid seen> [age]: another's mutex broken, its pid (and its age) read again right before
lkin() { # one try at the mutex: 0 = in, 1 = another's, 2 = it cannot be made (or its pid not written), 3 = a stale one broken (try again at once)
  if mkdir "$LKP.brk" 2>/dev/null; then
    if { echo $$ >"$LKP.brk/pid"; } 2>/dev/null && lkmine; then _bs=; return 0; fi
    rmdir "$LKP.brk" 2>/dev/null || rm -rf "$LKP.brk"; return 2
  fi
  lkmine && return 0 # already this shell's: its trap ran inside a section
  [ -d "$LKP.brk" ] || return 2 # gone again (tried again at once), or it cannot be made
  _q=; { read -r _q <"$LKP.brk/pid"; } 2>/dev/null
  if [ -n "$_q" ] && ! kill -0 "$_q" 2>/dev/null; then lkbrk "$_q" && return 3; return 1; fi
  if [ -z "$_bs" ] || [ "$_q" != "$_bq" ] || ! lkold "$LKP.brk" "$LKP.$$.b"; then touch "$LKP.$$.b" 2>/dev/null; _bs=$_e; _bq=$_q; return 1; fi
  if [ $((_e - _bs)) -ge 30 ] || { [ -z "$_q" ] && [ $((_e - _bs)) -ge 5 ]; }; then lkbrk "$_q" age && return 3; fi
  return 1
}
lkwait() { # the mutex, waited for (at most 40 s: a stuck one is broken by then): 0 = in, 1 = still busy, 2 = it cannot be made
  _t0=$(now); _i=0; _w=1; _y=0; _bs=; _bq=; _e=0
  while :; do
    if [ "$_t0" = 0 ]; then _e=$((_i / 10)); else _e=$(( $(now) - _t0 )); fi
    lkin; _c=$?
    [ "$_c" = 3 ] && continue
    if [ "$_c" = 2 ]; then _y=$((_y + 1)); [ "$_y" -lt 3 ] && continue; break; fi
    [ "$_c" = 1 ] && [ "$_e" -lt 40 ] || break
    lknap "$_w"; _w=$((_w * 2)); [ "$_w" -le 10 ] || _w=10
  done
  [ ! -e "$LKP.$$.b" ] || rm -f "$LKP.$$.b"; return "$_c"
}
lkdone() { rm -f "$LKP.$$.l" "$LKP.$$.b"; }
lksweep() { find "${LKP%/*}" -maxdepth 1 -name "${LKP##*/}.*.[lb]" 2>/dev/null | while IFS= read -r _f; do _s=${_f%.?}; _s=${_s##*.}; case "$_s" in ''|*[!0-9]*) ;; *) kill -0 "$_s" 2>/dev/null || rm -f "$_f" ;; esac; done; } # the stamps of waiters killed while they timed a lock: removed once their pid is gone
lkown() { # <ship|gate> <holder>, in the mutex: make the lock and write its owner line — 0 = held, 1 = not made, 2 = its owner line not written (removed again)
  lkmine && mkdir "$LKP" 2>/dev/null || return 1
  if { echo "$2 $(now) $1" >"$LKP/owner"; } 2>/dev/null; then HELD=1; lksweep; return 0; fi
  rmdir "$LKP" 2>/dev/null || rm -rf "$LKP"; return 2
}
shiplock() { # <ship|gate> [holder id, else this shell's pid]: take the repo's ship lock — one ship, or the gate, moves the run branch and the PR at a time
  _t0=$(now); _n=0; _p=; _t=0; _k=; _a=0; _i=0; _o=; _bs=; _bq=; _w=1; _y=0; _e=0
  while :; do
    if [ "$_t0" = 0 ]; then _e=$((_i / 10)); else _e=$(( $(now) - _t0 )); fi # waited: by the clock, or the sleeps where date +%s does not work (the wait had no end there)
    _x=2; _p=; _t=0; _k=; _a=0 # 2 = free, 1 = stale, 0 = held
    if [ -d "$LKP" ]; then
      _x=0; { read -r _p _t _k <"$LKP/owner"; } 2>/dev/null; case "$_t" in ''|*[!0-9]*) _t=0 ;; esac
      _a=$(( $(now) - _t ))
      if [ -z "$_p" ]; then # no owner line (yet): judged by the lock's own age (unchanged since a stamp made 10 s ago), never by how long this waiter has waited
        if [ -z "$_o" ] || ! lkold "$LKP" "$LKP.$$.l"; then touch "$LKP.$$.l" 2>/dev/null; _o=$_e; elif [ $((_e - _o)) -ge 10 ]; then _x=1; fi
        _a=$((_e - _o))
      else _o=
        if [ "$_k" = gate ]; then { [ "$GS" = 1 ] || [ "$_a" -ge 1200 ]; } && _x=1
        elif ! kill -0 "$_p" 2>/dev/null || [ "$_a" -ge 900 ]; then _x=1
        fi
      fi
    fi
    if [ "$_x" != 0 ]; then # free, or stale: taken in the mutex, the owner line read again there and compared whole before the lock is touched
      if [ "$_n" -ge 5 ]; then lkdone; echo "LOCK error: could not take over $LKP after 5 tries — nothing moves"; return 1; fi
      lkin; _c=$?
      [ "$_c" = 3 ] && continue
      if [ "$_c" = 0 ]; then
        _q=; _r=; _s=; { read -r _q _r _s <"$LKP/owner"; } 2>/dev/null; case "$_r" in ''|*[!0-9]*) _r=0 ;; esac
        _g=
        if [ ! -d "$LKP" ]; then _g=free
        elif [ "$_x" = 1 ] && [ "$_q $_r $_s" = "$_p $_t $_k" ] && { [ -n "$_q" ] || lkold "$LKP" "$LKP.$$.l"; } && lkmine; then rm -rf "$LKP"; _n=$((_n + 1)); _g=stale # the same stale holder, the mutex still this shell's
        fi
        if [ -n "$_g" ]; then
          lkown "$1" "${2:-$$}"; _c=$?
          if [ "$_c" = 0 ]; then lkout; lkdone; [ "$_g" = stale ] && echo "LOCK stale: ${_k:-no owner} ${_p:-?} (${_a} s) — taken over"; return 0; fi
          lkout
          if [ "$_c" = 2 ]; then lkdone; echo "LOCK error: cannot write $LKP/owner — nothing moves"; return 1; fi
          [ "$_g" = stale ] && continue # not removed: tried again, five times at most
          _c=2 # free, yet it cannot be made
        else lkout
        fi
      fi
      if [ "$_c" = 2 ]; then _y=$((_y + 1)); [ "$_y" -lt 3 ] && continue; lkdone; echo "LOCK error: cannot create $LKP (not writable?) — nothing moves"; return 1; fi
    fi
    _y=0
    if [ "$_e" -ge "$LW" ]; then lkdone; echo "LOCK busy: held by ${_k:-?} ${_p:-?} for ${_a} s"; return 1; fi
    if [ "$_x" != 0 ]; then lknap "$_w"; _w=$((_w * 2)); [ "$_w" -le 10 ] || _w=10; else lknap 10; fi # free or stale, the mutex busy: 0.1 s, doubling up to 1 s
  done
}
lkrel() { # <holder> <ship|gate>: release the lock in the mutex, only while its owner line still names this holder as that — 0 = removed, 1 = another's (left alone), 2 = no lock there (nothing removed), 3 = the mutex stayed busy (left alone)
  lkwait || return 3
  _p=; _t=; _k=; { read -r _p _t _k <"$LKP/owner"; } 2>/dev/null
  if [ ! -d "$LKP" ]; then _c=2; elif [ "$_p $_k" != "$1 $2" ]; then _c=1; elif lkmine; then rm -rf "$LKP"; _c=0; else _c=3; fi
  lkout; return "$_c"
}
lkbeat() { # <holder>: the gate's heartbeat renews its lock in the mutex, only while the owner line still names this holder as gate; another's line (or none) stops it (1), said so
  lkwait || return 0 # the mutex stayed busy: this beat is skipped
  _p=; _t=; _k=; { read -r _p _t _k <"$LKP/owner"; } 2>/dev/null
  if [ "$_p $_k" = "$1 gate" ]; then lkmine && { echo "$1 $(now) gate" >"$LKP/owner"; } 2>/dev/null; lkout; return 0; fi
  lkout
  if [ -d "$LKP" ]; then echo "LOCK kept: held by ${_k:-?} ${_p:-?} now, not this gate — the heartbeat stopped"; else echo "LOCK kept: no lock there now — the heartbeat stopped"; fi
  return 1
}
shipunlock() { # at the script's end, or from its trap: a lock taken over meanwhile is the new holder's
  lkdone; if [ "$HELD" != 1 ]; then lkout; return 0; fi; HELD=0
  lkrel "$$" ship; case $? in
    1) echo "LOCK kept: held by ${_k:-?} ${_p:-?} now, not this script — left alone" ;;
    3) echo "LOCK kept: $LKP.brk stayed busy — left alone, taken over once this script is gone" ;;
  esac; return 0
}
