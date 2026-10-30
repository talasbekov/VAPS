"""Converter profiles are local file URIs, including Windows and escaped paths."""
from pathlib import Path
from types import SimpleNamespace

from organization_management.apps.ops import documents


def test_converter_profile_is_an_absolute_encoded_file_uri(monkeypatch, tmp_path):
    workdir = tmp_path / "conversion space #1"
    workdir.mkdir()
    monkeypatch.setattr(documents.tempfile, "mkdtemp", lambda: str(workdir))
    monkeypatch.setattr(documents.shutil, "which", lambda _: "soffice")
    calls = []

    def convert(argv, **kwargs):
        calls.append(argv)
        Path(argv[argv.index("--outdir") + 1], "sample.pdf").write_bytes(b"%PDF-test")
        return SimpleNamespace(stderr=b"", returncode=0)

    monkeypatch.setattr(documents.subprocess, "run", convert)
    assert documents.docx_to_pdf("sample.docx") == b"%PDF-test"
    assert calls[0][1] == "-env:UserInstallation=" + (workdir / "profile").as_uri()
    assert "%20" in calls[0][1] and "%23" in calls[0][1]
    assert not workdir.exists(), "temporary conversion profile must be cleaned up"
