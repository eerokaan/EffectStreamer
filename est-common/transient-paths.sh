#!/usr/bin/env bash
# Source-build helper: deliberately does not require Node.js.
est_transient_base() {
    local anchor hash
    anchor=$(cd -P -- "$1" && pwd -P) || return
    hash=$(printf '%s' "$anchor" | sha256sum) || return
    printf '/tmp/effectstreamer/uid-%s/%s' "$(id -u)" "${hash:0:16}"
}
est_transient_path() {
    local base part
    base=$(est_transient_base "$1") || return; shift
    for part in "$@"; do
        case "$part" in ''|.|..|*/*|*\\*) echo 'Unsafe transient path segment' >&2; return 1;; esac
        base="$base/$part"
    done
    printf '%s\n' "$base"
}
est_transient_secure_dir() {
    local directory=$1 owner mode
    if [[ ! -e "$directory" && ! -L "$directory" ]]; then mkdir -m 700 -- "$directory" || return; fi
    if [[ -L "$directory" || ! -d "$directory" ]]; then echo "Unsafe transient directory: $directory" >&2; return 1; fi
    read -r owner mode < <(stat -c '%u %a' -- "$directory")
    if [[ "$directory" == /tmp/effectstreamer && "$owner" == 0 ]] && (( (8#$mode & 01000) != 0 )); then return; fi
    if [[ "$owner" != "$(id -u)" ]] || (( (8#$mode & 022) != 0 )); then
        echo "Unsafe transient directory permissions: $directory" >&2; return 1
    fi
}
est_transient_ensure() {
    local directory=$1 current=/tmp/effectstreamer part relative
    est_transient_secure_dir "$current" || return
    relative=${directory#"$current"/}
    local -a parts
    IFS=/ read -r -a parts <<< "$relative"
    for part in "${parts[@]}"; do
        [[ "$part" != .. && -n "$part" ]] || return 1
        current="$current/$part"; est_transient_secure_dir "$current" || return
    done
}
est_transient_prepare() {
    EST_TRANSIENT_BASE=$(est_transient_base "$1") || return
    EST_TRANSIENT_COMPONENT=$2
    est_transient_ensure "$EST_TRANSIENT_BASE/$2/runs" || return
    EST_TRANSIENT_RUN_DIR=$(mktemp -d "$EST_TRANSIENT_BASE/$2/runs/run-XXXXXX") || return
    TMPDIR="$EST_TRANSIENT_RUN_DIR/tmp"; est_transient_secure_dir "$TMPDIR" || return
    TMP=$TMPDIR; TEMP=$TMPDIR; XDG_CACHE_HOME="$EST_TRANSIENT_BASE/$2/cache"
    est_transient_ensure "$XDG_CACHE_HOME" || return
    export EST_TRANSIENT_BASE EST_TRANSIENT_RUN_DIR TMPDIR TMP TEMP XDG_CACHE_HOME
}
est_transient_validate_output() {
    local absolute current
    absolute=$(realpath -ms -- "$1") || return
    case "$absolute" in "$EST_TRANSIENT_BASE"/*) ;; *) echo "Output must be inside managed transient namespace: $EST_TRANSIENT_BASE" >&2; return 1;; esac
    current=$absolute
    while [[ "$current" != /tmp ]]; do
        if [[ -L "$current" ]]; then echo "Unsafe transient output symlink: $current" >&2; return 1; fi
        if [[ -d "$current" ]]; then est_transient_secure_dir "$current" || return; fi
        current=$(dirname -- "$current")
    done
}
est_transient_acquire_lock() {
    est_transient_ensure "$EST_TRANSIENT_BASE/$EST_TRANSIENT_COMPONENT/locks" || return
    EST_TRANSIENT_LOCK="$EST_TRANSIENT_BASE/$EST_TRANSIENT_COMPONENT/locks/$1.lock"
    if ! mkdir -m 700 -- "$EST_TRANSIENT_LOCK"; then
        echo "Build lock exists: $EST_TRANSIENT_LOCK; stop its owner before removing a stale lock" >&2; return 1
    fi
}
est_transient_release_lock() { rmdir -- "$EST_TRANSIENT_LOCK"; }
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    if [[ "${1:-}" != path ]]; then echo 'Usage: transient-paths.sh path COMPONENT SEGMENTS...' >&2; exit 1; fi
    shift
    est_transient_path "$(cd -- "$(dirname -- "$0")/.." && pwd -P)" "$@"
fi
