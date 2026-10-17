#!/bin/sh
# Drain sanitized nginx stderr before PID1 exits, including boot failures.
set -eu
log_dir=$(mktemp -d /tmp/contour-nginx-log.XXXXXX)
log_fifo=$log_dir/stderr
trap 'rm -f "$log_fifo"; rmdir "$log_dir"' EXIT
mkfifo -m 600 "$log_fifo"

nginx_pid=
signal_count=0
forward_signal() {
    signal_count=$((signal_count + 1))
    if [ -n "$nginx_pid" ]; then
        kill -s "$1" "$nginx_pid" 2>/dev/null || true
    fi
}
trap 'forward_signal TERM' TERM
trap 'forward_signal INT' INT
trap 'forward_signal QUIT' QUIT
trap 'forward_signal HUP' HUP
trap 'forward_signal USR1' USR1

# The reader inherits the original stderr. nginx alone writes to the FIFO;
# the supervisor holds no write descriptor, so nginx exit produces EOF.
awk -f /usr/local/lib/nginx-error-filter.awk < "$log_fifo" >&2 &
filter_pid=$!
/docker-entrypoint.sh "$@" 2> "$log_fifo" &
nginx_pid=$!

wait_child() {
    while :; do
        previous_signal_count=$signal_count
        if wait "$1"; then child_status=0; else child_status=$?; fi
        # A caught signal interrupts shell wait, not the child's lifecycle.
        # Wait again for the actual child status after forwarding the signal.
        if [ "$signal_count" -ne "$previous_signal_count" ] && [ "$child_status" -gt 128 ]; then
            continue
        fi
        return "$child_status"
    done
}

if wait_child "$nginx_pid"; then nginx_status=0; else nginx_status=$?; fi
nginx_pid=
if wait_child "$filter_pid"; then filter_status=0; else filter_status=$?; fi
if [ "$nginx_status" -eq 0 ] && [ "$filter_status" -ne 0 ]; then
    echo 'nginx stderr redactor failed' >&2
    exit "$filter_status"
fi
exit "$nginx_status"
