# nginx error messages can repeat the URI in request, upstream and referrer.
# Strip query segments everywhere while preserving the diagnostic and paths.
{
    gsub(/\?[^[:space:]"]*/, "?[redacted]")
    print
    fflush()
}
