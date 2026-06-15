"""Root test configuration: hypothesis profiles (architecture.md).

``ci`` (default) keeps property tests inside the local/gate time budget;
``full`` is the nightly-depth run wired to ``make test-full``.
"""

import os

from hypothesis import settings

# deadline=None: property tests assert determinism/correctness, not
# latency — the default 200ms/example deadline is a CI-flake source on the
# heavier full profile (review C3/KO-4 2026-06-15).
settings.register_profile("ci", max_examples=10, deadline=None)
settings.register_profile("full", max_examples=500, deadline=None)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "ci"))
