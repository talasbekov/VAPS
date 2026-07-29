"""Story 13.2 — export_diagnostics: scrubber unit tests + real command
integration (archive contents, AuditLog row for the export itself)."""

import zipfile

import pytest
from django.core.management import CommandError, call_command

from apps.audit.diagnostics_export import scrub_description
from apps.audit.models import AuditLog
from apps.operations.bugreports.models import BugReport

pytestmark = pytest.mark.django_db


class TestScrubDescription:
    def test_masks_iin_like_12_digit_sequences(self):
        assert scrub_description("ИИН 123456789012 тест") == "ИИН [ИИН скрыт] тест"

    def test_masks_phone_like_sequences(self):
        out = scrub_description("звоните +7 701 234 56 78 срочно")
        assert "[телефон скрыт]" in out
        assert "701" not in out

    def test_masks_email(self):
        assert scrub_description("пишите test@example.com") == "пишите [email скрыт]"

    def test_leaves_ordinary_text_untouched(self):
        text = "Кнопка «Сдать день» не реагирует на клик."
        assert scrub_description(text) == text


class TestExportDiagnosticsCommand:
    def _seed_bugreport(self, description="обычный текст без ПДн"):
        return BugReport.objects.create(
            user_id="op-1",
            screen_path="/x",
            app_version="1.0",
            build_sha="abc",
            last_request_ids=["r1"],
            description=description,
        )

    def test_requires_actor(self, tmp_path):
        self._seed_bugreport()
        with pytest.raises(CommandError, match="actor"):
            call_command(
                "export_diagnostics",
                "--from",
                "2020-01-01",
                "--to",
                "2030-12-31",
                "--actor",
                "",
                "--out-dir",
                str(tmp_path),
            )

    def test_rejects_from_after_to(self, tmp_path):
        with pytest.raises(CommandError, match="must not be after"):
            call_command(
                "export_diagnostics",
                "--from",
                "2030-01-01",
                "--to",
                "2020-01-01",
                "--actor",
                "dev",
                "--out-dir",
                str(tmp_path),
            )

    def test_builds_archive_with_scrubbed_bugreports_and_records_audit(
        self, tmp_path
    ):
        report = self._seed_bugreport(
            description="ИИН 123456789012, пишите ops@example.com"
        )

        call_command(
            "export_diagnostics",
            "--from",
            "2020-01-01",
            "--to",
            "2030-12-31",
            "--actor",
            "dev-1",
            "--out-dir",
            str(tmp_path),
        )

        archives = list(tmp_path.glob("*.zip"))
        assert len(archives) == 1
        with zipfile.ZipFile(archives[0]) as zf:
            names = set(zf.namelist())
            assert names == {"bugreports.json", "audit_log.json", "manifest.json"}
            bugreports_body = zf.read("bugreports.json").decode("utf-8")
            assert str(report.id) in bugreports_body
            # AC-2: PII scrubbed before it ever reaches the archive.
            assert "123456789012" not in bugreports_body
            assert "ops@example.com" not in bugreports_body
            manifest = zf.read("manifest.json").decode("utf-8")
            assert '"bugreports_count": 1' in manifest

        # AC-3: the export itself is recorded — first management command in
        # this codebase to call apps.audit.services.record().
        entry = AuditLog.objects.get(action="DIAGNOSTICS_EXPORTED")
        assert entry.actor_user_id == "dev-1"
        assert entry.entity_type == "diagnostics_export"
        assert entry.ip_address == "0.0.0.0"  # _SYSTEM_IP sentinel, no HTTP context
        assert entry.new_value["archive"] == archives[0].name

    def test_audit_log_export_excludes_old_new_value(self, tmp_path):
        # AC-2/Out of Scope: old_value/new_value are where real business-data
        # PII risk lives — deliberately never serialized into audit_log.json.
        AuditLog.objects.create(
            id="11111111-1111-1111-1111-111111111111",
            actor_user_id="someone",
            action="ASSIGNMENT_CREATED",
            entity_type="assignment",
            entity_id="22222222-2222-2222-2222-222222222222",
            old_value=None,
            new_value={"secret_business_field": "sensitive-value-xyz"},
            ip_address="10.0.0.1",
            created_at="2026-07-01T09:00:00+05:00",
        )

        call_command(
            "export_diagnostics",
            "--from",
            "2026-01-01",
            "--to",
            "2026-12-31",
            "--actor",
            "dev-2",
            "--out-dir",
            str(tmp_path),
        )

        archives = list(tmp_path.glob("*.zip"))
        with zipfile.ZipFile(archives[0]) as zf:
            audit_log_body = zf.read("audit_log.json").decode("utf-8")
            assert "sensitive-value-xyz" not in audit_log_body
            assert "ASSIGNMENT_CREATED" in audit_log_body
