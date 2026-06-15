from rest_framework.authentication import BaseAuthentication


class XUserIdAuthentication(BaseAuthentication):
    """Single identity-extraction point (ARCH-SEC-030).

    MVP stand-in for the JWT `sub` claim (spec §7007): the external auth
    account id arrives in the X-User-Id header. On the move to JWT ONLY this
    class changes; everything downstream keys on `request.actor_id`.

    No AuthenticationFailed on a missing header: a 401 here would mask the
    403 PERMISSION_DENIED contract enforced by the permission layer. No User
    DB lookup per request: downstream keys on the actor_id string (ARCH-007).
    """

    def authenticate(self, request):
        user_id = request.headers.get("X-User-Id")
        if user_id:
            request.actor_id = user_id
        return None
