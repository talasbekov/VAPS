def get_user_id(request):
    """MVP stand-in for the JWT `sub` claim (spec §7007).

    Reads the external auth account id from the X-User-Id header. Replace with
    real authentication later; everything downstream already keys on this string.
    """
    user_id = request.headers.get("X-User-Id")
    return user_id or None
