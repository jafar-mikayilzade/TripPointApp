"""Corporate MITM SSL workaround for outbound HTTPS (Supabase, Overpass).

Import this module before creating HTTP clients when TRIPPOINT_SSL_INSECURE=1
(or when the default is needed on locked-down corp networks).
"""

from __future__ import annotations

import os
import ssl

_APPLIED = False


def apply_insecure_ssl() -> None:
    """Disable TLS certificate verification for requests/httpx/stdlib HTTPS."""
    global _APPLIED
    if _APPLIED:
        return
    _APPLIED = True

    ssl._create_default_https_context = ssl._create_unverified_context  # noqa: SLF001

    try:
        import urllib3

        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass

    try:
        import requests

        _orig = requests.sessions.Session.request

        def _request(self, method, url, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["verify"] = False
            return _orig(self, method, url, **kwargs)

        requests.sessions.Session.request = _request  # type: ignore[method-assign]
    except Exception:
        pass

    try:
        import httpx

        _httpx_init = httpx.Client.__init__

        def _httpx_client_init(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["verify"] = False
            return _httpx_init(self, *args, **kwargs)

        httpx.Client.__init__ = _httpx_client_init  # type: ignore[method-assign]
    except Exception:
        pass


# Auto-apply only when explicitly enabled (never default-on).
if os.getenv("TRIPPOINT_SSL_INSECURE", "0").strip() in {"1", "true", "True"}:
    apply_insecure_ssl()
