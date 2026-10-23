"""Scoped read-only journal, administrative hours and a matching CSV slice."""
import csv
import io
import json
import tempfile
from datetime import datetime
from urllib.parse import quote

from django.db import connection
from asgiref.sync import sync_to_async
from django.http import StreamingHttpResponse

from organization_management.apps.operations.clock import Clock, _local_tz
from organization_management.apps.ops.duty_register_query import ROW_COLUMNS, register_cte, snapshot_sql
from organization_management.apps.ops.duty_read_snapshot import read_snapshot

SOURCE_LABELS = {"LOG": "Журнал", "PLAN": "План дежурств", "DISPATCH": "Расстановка", "STATUS": "Кадровый статус"}
STATE_LABELS = {"PLANNED": "Запланировано", "ACKNOWLEDGED": "Подтверждено", "ACTIVE": "Начато",
                "COMPLETED": "Завершено", "CANCELLED": "Отменено"}
ATTENTION_LABELS = {
    "MISSING_KIND": "Вид не указан", "MISSING_ACKNOWLEDGEMENT": "Подтверждение не отмечено",
    "MISSING_START": "Начало не отмечено", "MISSING_END": "Завершение не отмечено",
    "INVALID_ACTUAL_FACTS": "Неполные или противоречивые фактические отметки",
    "SOURCE_CHANGED": "Исходная запись изменилась", "OVERLAP": "Пересечение записей сотрудника",
    "EMPLOYEE_UNKNOWN": "Сотрудник не найден в кадровом учёте",
    "LATE_START": "Фактическое начало позже планового",
}


@read_snapshot()
def snapshot(actor, query):
    cte, params = register_cte(actor, query)
    with connection.cursor() as cursor:
        cursor.execute(snapshot_sql(cte), params)
        raw = cursor.fetchone()[0]
    result = json.loads(raw) if isinstance(raw, str) else raw
    result.update(period={"from": query["from"].isoformat(), "to": query["to"].isoformat()},
                  generated_at=Clock.to_local(params["now"]).isoformat(), time_zone=params["zone"])
    result["labels"] = {"sources": SOURCE_LABELS, "states": STATE_LABELS, "attention": ATTENTION_LABELS}
    return result


def safe_cell(value):
    text = str(value or "")
    # Spreadsheet formulas also execute after leading whitespace/control chars.
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


def csv_time(value):
    if value is None:
        return ""
    stamp = datetime.fromisoformat(value) if isinstance(value, str) else value
    return Clock.to_local(stamp).strftime("%d.%m.%Y %H:%M")


def csv_hours(value):
    return "" if value is None else f"{float(value) / 60:.2f}".replace(".", ",")


class CsvDownload:
    """Async bytes avoid Django ASGI buffering a synchronous iterator."""
    def __init__(self, file):
        self.file = file

    async def __aiter__(self):
        try:
            while chunk := await sync_to_async(self.file.read, thread_sensitive=False)(65536):
                yield chunk
        finally:
            self.close()

    def close(self):
        # StreamingHttpResponse also registers this closer for disconnects.
        self.file.close()


@read_snapshot()
def export_csv(actor, query):
    cte, params = register_cte(actor, query)
    file = tempfile.TemporaryFile(mode="w+b")
    try:
        text_file = io.TextIOWrapper(file, encoding="utf-8-sig", newline="")
        writer = csv.writer(text_file, delimiter=";", lineterminator="\r\n")
        writer.writerow(["Запись", "Источник", "Сотрудник", "Подразделение", "Вид дежурства", "Состояние",
            "Плановое начало", "Плановое завершение", "Плановые часы в периоде", "Подтверждено",
            "Фактическое начало", "Фактическое завершение", "Фактические часы записи в периоде",
            "Место", "Основание", "Примечание", "Контрольные отметки"])
        # Named server cursor retains one SQL snapshot without buffering all
        # database rows on the client. The generated CSV is held on disk.
        with connection.chunked_cursor() as cursor:
            cursor.execute(cte + f"SELECT {ROW_COLUMNS} FROM filtered ORDER BY COALESCE(planned_start,business_date::timestamp AT TIME ZONE %(zone)s) DESC,source DESC,source_id DESC", params)
            batch = cursor.fetchmany(1000)
            columns = [column[0] for column in cursor.description]
            while batch:
                for values in batch:
                    row = dict(zip(columns, values))
                    writer.writerow([safe_cell(row["id"]), SOURCE_LABELS[row["source"]],
                        safe_cell(row["employee_name"]), safe_cell(row["division_name"]), safe_cell(row["service_duty_label"]),
                        STATE_LABELS[row["state"]], csv_time(row["planned_start"]), csv_time(row["planned_end"]),
                        csv_hours(row["period_planned_minutes"]), csv_time(row["acknowledged_at"]),
                        csv_time(row["actual_start"]), csv_time(row["actual_end"]), csv_hours(row["period_actual_minutes"]),
                        safe_cell(row["location_label"]), safe_cell(row["document_basis"]), safe_cell(row["note"]),
                        "; ".join(ATTENTION_LABELS[code] for code in row["attention_codes"])])
                batch = cursor.fetchmany(1000)
        text_file.flush()
        text_file.detach()
        length = file.tell()
        file.seek(0)
        response = StreamingHttpResponse(CsvDownload(file), content_type="text/csv; charset=utf-8")
    except BaseException:
        file.close()
        raise
    name = f"Журнал дежурств {query['from'].isoformat()} — {query['to'].isoformat()}.csv"
    response["Content-Disposition"] = f"attachment; filename=\"duty-register.csv\"; filename*=UTF-8''{quote(name)}"
    response["Content-Length"] = str(length)
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response
