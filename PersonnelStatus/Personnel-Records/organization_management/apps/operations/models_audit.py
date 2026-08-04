"""Журнал доменных событий раздела ОМ (порт AuditLog из Backend/VAPS
apps/audit/models.py).

ТАБЛИЦА РЯДОМ со старым журналом (решение Bratan, 04.08.2026) — тот же приём
strangler, что и со статусами. Почему не пишем в старый audit.AuditLog:

- там актор — FK на User, а раздел пишет актора СТРОКОЙ: у системных закрытий
  (увольнение, будущие проекции) живого пользователя нет вовсе;
- там закрытый список действий HTTP-образный (CREATE/UPDATE/DELETE), и точное
  доменное событие пришлось бы прятать в payload — фильтр по типу события
  превратился бы в раскопки JSON;
- старый журнал наполняет middleware на КАЖДЫЙ успешный /api/-запрос, то есть
  HTTP-слой уже записан. Доменное событие рядом с ним дало бы две записи об
  одной мутации с разным смыслом.

Старый журнал и его экраны не тронуты: два журнала о разном — HTTP-обращения и
доменные факты раздела.

Отличия от источника: int-pk и int-ссылка на сущность (у старой структуры всё
целочисленное, UUID здесь взяться неоткуда); полей request_id/ip/user_agent
НЕТ — их наполняет request-контекст, которого в старом проекте не существует,
а пустые колонки «на будущее» лгут о том, что данные собираются.
"""
from django.db import models


class OpsAuditLog(models.Model):
    """Одна запись журнала. Только добавление: правка и удаление запрещены
    триггером БД (миграция 0006), а не только договорённостью.

    created_at БЕЗ auto_now_add намеренно: время ставит сервис записи через
    часы РАЗДЕЛА — иначе журнал шёл бы по своим часам, а факты по своим, и
    события задним числом (перенос данных, догон) легли бы с временем импорта.
    """

    # Актор строкой: str(User.pk) для человека, нечисловая метка для системы.
    actor_user_id = models.CharField(max_length=255)
    # UPPER_SNAKE-код из закрытого словаря (audit_service.ACTIONS).
    action = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=100)
    entity_id = models.IntegerField()
    # Снимки «до» и «после»: у создания нет «до», у удаления не было бы
    # «после» — отсюда null, а не пустой словарь (пустой означал бы «объект
    # был, и он был пуст»).
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField()

    class Meta:
        db_table = "ops_audit_logs"
        # Журнал читают «по сущности во времени» и «по актору во времени» —
        # оба разреза индексированы, иначе лента за месяц уедет в полный скан.
        indexes = [
            models.Index(
                fields=["entity_type", "entity_id", "created_at"],
                name="idx_ops_audit_entity",
            ),
            models.Index(
                fields=["actor_user_id", "created_at"], name="idx_ops_audit_actor"
            ),
            models.Index(fields=["action", "created_at"], name="idx_ops_audit_action"),
        ]

    def __str__(self):
        return f"{self.action}:{self.entity_type}:{self.entity_id}"
