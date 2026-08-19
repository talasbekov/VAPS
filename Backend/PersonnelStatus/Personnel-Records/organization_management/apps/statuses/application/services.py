"""
Сервисный слой для управления статусами сотрудников
"""
import logging
from datetime import date, timedelta
from typing import Optional, List, Dict, Any
from django.db import transaction
from django.db.models import Q, QuerySet
from django.core.exceptions import ValidationError
from django.utils import timezone

from organization_management.apps.statuses.models import (
    EmployeeStatus,
    StatusChangeHistory,
    StatusDocument
)
from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.selectors import status_on_date
from organization_management.apps.divisions.models import Division

logger = logging.getLogger(__name__)


class StatusApplicationService:
    """Сервис для управления статусами сотрудников"""

    @transaction.atomic
    def create_status(
        self,
        employee_id: int,
        status_type: str,
        start_date: date,
        end_date: Optional[date] = None,
        comment: str = "",
        location: str = "",
        related_division_id: Optional[int] = None,
        user=None
    ) -> EmployeeStatus:
        """
        Создание нового статуса сотрудника

        Args:
            employee_id: ID сотрудника
            status_type: Тип статуса
            start_date: Дата начала статуса
            end_date: Дата окончания статуса
            comment: Комментарий
            location: Место (для командировки/учебы)
            related_division_id: ID связанного подразделения (для прикомандирования)
            user: Пользователь, создавший статус

        Returns:
            EmployeeStatus: Созданный статус
        """
        try:
            employee = Employee.objects.get(pk=employee_id)
        except Employee.DoesNotExist:
            raise ValidationError(f"Сотрудник с ID {employee_id} не найден.")

        related_division = None
        if related_division_id:
            try:
                related_division = Division.objects.get(pk=related_division_id)
            except Division.DoesNotExist:
                raise ValidationError(f"Подразделение с ID {related_division_id} не найдено.")

        # Автоматически завершаем текущий активный статус.
        # ВАЖНО: Завершаем только если новый статус уже начался (не запланированный в будущем)
        #
        # Прикомандирование раньше было исключено с обеих сторон: и новый
        # статус-прикомандирование не закрывал текущий, и текущее
        # прикомандирование не закрывалось новым статусом. Это противоречило
        # EmployeeStatus.clean, который пересечения запрещает: откомандировать
        # человека «в строю» было нельзя — save() падал на пересечении, — и
        # вернуть откомандированному обычный статус тоже. Правило теперь одно
        # и то же для всех типов: активный статус у сотрудника один.
        today = timezone.now().date()

        # ПЕРВЫМ ДЕЛОМ — снять запланированное «В строю», перекрытое новым
        # статусом. Порядок не косметический: закрытие активного статуса ниже
        # пересохраняет его, а save() гоняет full_clean, и та же проверка
        # пересечений валит УЖЕ СУЩЕСТВУЮЩУЮ строку о запланированную. Отказ
        # при этом выглядел так, будто мешает новый статус.
        self._cancel_superseded_planned_in_service(
            employee_id=employee_id,
            start_date=start_date,
            end_date=end_date,
            user=user,
        )

        if start_date <= today:  # Только для статусов, которые уже начались
            self._close_active_statuses(
                employee_id=employee_id,
                start_date=start_date,
                new_status_type=status_type,
                user=user,
            )

        status = EmployeeStatus(
            employee=employee,
            status_type=status_type,
            start_date=start_date,
            end_date=end_date,
            comment=comment,
            location=location,
            related_division=related_division,
            created_by=user,
            actual_end_date=None,  # Явно устанавливаем None при создании
            early_termination_reason='',  # Пустая строка по умолчанию
            state=None  # Явно None, чтобы метод save() определил состояние по датам
        )
        status.save()

        # Создаем запись в истории изменений
        StatusChangeHistory.objects.create(
            status=status,
            change_type=StatusChangeHistory.ChangeType.CREATED,
            changed_by=user,
            comment=f"Создан статус '{status.get_status_type_display()}'"
        )

        return status

    def _close_active_statuses(
        self,
        employee_id: int,
        start_date: date,
        new_status_type: str,
        user=None
    ) -> None:
        """Убрать действующие статусы сотрудника, уступающие место новому.

        Общий шаг для ДВУХ путей: ручной смены статуса (create_status) и
        автоматической активации запланированного (apply_planned_statuses).
        Второй раньше этого шага не делал, и после активации у человека
        оставалось два активных статуса разом.

        Сам активируемый статус под выборку не подпадает: на этот момент он
        ещё PLANNED, а берутся только ACTIVE. Отдельного исключения по id тут
        нет намеренно — это был бы второй владелец одного правила.
        """
        # lte, а не lt: статус, заведённый СЕГОДНЯ, тоже нужно убрать с
        # дороги. С `lt` он оставался активным, и clean валил новый статус
        # пересечением — вторая замена статуса за день была невозможна.
        current_statuses = EmployeeStatus.objects.filter(
            employee_id=employee_id,
            state=EmployeeStatus.StatusState.ACTIVE,
            start_date__lte=start_date
        )

        for current_status in current_statuses:
            if current_status.start_date < start_date:
                # Завершаем текущий статус датой, предшествующей новому
                current_status.actual_end_date = start_date - timedelta(days=1)
                current_status.state = EmployeeStatus.StatusState.COMPLETED
                change_type = StatusChangeHistory.ChangeType.TERMINATED
                comment = "Автоматически завершен при создании нового статуса"
            else:
                # Начат в тот же день — завершить его «вчера» нельзя
                # (actual_end_date раньше start_date модель запрещает), а
                # оставить активным нельзя тем более. Такой статус не
                # продержался ни одного дня — он отменён, а не завершён.
                current_status.state = EmployeeStatus.StatusState.CANCELLED
                change_type = StatusChangeHistory.ChangeType.CANCELLED
                comment = "Автоматически отменён: заменён другим статусом в тот же день"
            current_status.early_termination_reason = (
                f"Автоматически завершен при установке нового статуса '{new_status_type}'"
            )
            current_status._skip_history_log = True
            current_status.save()

            StatusChangeHistory.objects.create(
                status=current_status,
                change_type=change_type,
                changed_by=user,
                comment=comment
            )

    def _cancel_superseded_planned_in_service(
        self,
        employee_id: int,
        start_date: date,
        end_date: Optional[date],
        user=None
    ) -> None:
        """Снять запланированное «В строю», перекрытое новым статусом.

        «В строю» — фоновое состояние, а не обещание: оно ничего не утверждает
        и уступает любому реальному статусу. Но правило «один активный статус»
        не делало для него исключения, и запланированная строка блокировала
        сотруднику ВСЁ начиная со дня своего начала. Строку такого вида —
        «В строю» без даты конца, со следующего дня — заводит сама автоматика
        после досрочного завершения: один возврат из прикомандирования
        закрывал человеку любые статусы на будущее.

        Отменяется, а не сдвигается: когда новый статус кончится,
        complete_expired_statuses заведёт «В строю» заново, с нужной даты.

        РЕАЛЬНЫЕ запланированные статусы (отпуск, командировка) здесь не
        трогаются: они — обещание, данное человеку, и молча затирать их хуже
        отказа. Такое пересечение по-прежнему отклоняется, и отказ называет
        мешающий статус с его периодом.
        """
        # Открытый период нового статуса перекрывает всё будущее.
        #
        # Условия на конец «В строю» здесь нет и оно не нужно: у этого типа
        # даты конца не бывает (clean её запрещает), он всегда открыт вправо.
        # Значит перекрытие определяется одним началом — второе условие было
        # бы недостижимой веткой, а не защитой.
        new_end = end_date or date.max
        superseded = EmployeeStatus.objects.filter(
            employee_id=employee_id,
            state=EmployeeStatus.StatusState.PLANNED,
            status_type=EmployeeStatus.StatusType.IN_SERVICE,
            start_date__lte=new_end,
        )

        reason = "Автоматически отменён: период перекрыт новым статусом"
        superseded_ids = list(superseded.values_list("id", flat=True))
        if not superseded_ids:
            return

        # update(), а не save(): save() гонит full_clean, а он сверяет строку с
        # СОСЕДЯМИ. Для строки, которую мы как раз убираем из активных, это
        # бессмысленно и вдобавок неисполнимо на старых данных: пара «В строю»
        # (действующее + запланированное следом), оставшаяся от прежней
        # автоматики, валит пересохранение любой своей половины о вторую.
        EmployeeStatus.objects.filter(id__in=superseded_ids).update(
            state=EmployeeStatus.StatusState.CANCELLED,
            early_termination_reason=reason,
        )
        for planned in EmployeeStatus.objects.filter(id__in=superseded_ids):
            StatusChangeHistory.objects.create(
                status=planned,
                change_type=StatusChangeHistory.ChangeType.CANCELLED,
                changed_by=user,
                comment=reason,
            )

    @transaction.atomic
    def plan_status(
        self,
        employee_id: int,
        status_type: str,
        start_date: date,
        end_date: date,
        comment: str = "",
        location: str = "",
        related_division_id: Optional[int] = None,
        user=None
    ) -> EmployeeStatus:
        """
        Планирование будущего статуса сотрудника

        Args:
            employee_id: ID сотрудника
            status_type: Тип статуса
            start_date: Дата начала статуса (должна быть в будущем)
            end_date: Дата окончания статуса
            comment: Комментарий
            location: Место (для командировки/учебы)
            related_division_id: ID связанного подразделения
            user: Пользователь, создавший статус

        Returns:
            EmployeeStatus: Созданный запланированный статус
        """
        if start_date <= timezone.now().date():
            raise ValidationError("Дата начала запланированного статуса должна быть в будущем.")

        status = self.create_status(
            employee_id=employee_id,
            status_type=status_type,
            start_date=start_date,
            end_date=end_date,
            comment=comment,
            location=location,
            related_division_id=related_division_id,
            user=user
        )

        return status

    @transaction.atomic
    def extend_status(
        self,
        status_id: int,
        new_end_date: date,
        user=None
    ) -> EmployeeStatus:
        """
        Продление существующего статуса

        Args:
            status_id: ID статуса
            new_end_date: Новая дата окончания
            user: Пользователь, выполняющий продление

        Returns:
            EmployeeStatus: Обновленный статус
        """
        try:
            status = EmployeeStatus.objects.get(pk=status_id)
        except EmployeeStatus.DoesNotExist:
            raise ValidationError(f"Статус с ID {status_id} не найден.")

        status.extend(new_end_date, user)
        return status

    @transaction.atomic
    def terminate_status_early(
        self,
        status_id: int,
        termination_date: date,
        reason: str,
        user=None
    ) -> EmployeeStatus:
        """
        Досрочное завершение статуса

        Args:
            status_id: ID статуса
            termination_date: Дата досрочного завершения
            reason: Причина досрочного завершения
            user: Пользователь, выполняющий завершение

        Returns:
            EmployeeStatus: Обновленный статус
        """
        try:
            status = EmployeeStatus.objects.get(pk=status_id)
        except EmployeeStatus.DoesNotExist:
            raise ValidationError(f"Статус с ID {status_id} не найден.")

        if not reason:
            raise ValidationError("Необходимо указать причину досрочного завершения.")

        status.terminate_early(termination_date, reason, user)

        # Автоматически создаем статус "В строю" после завершения.
        #
        # С ДНЯ завершения, а не со следующего: досрочное завершение означает,
        # что человек вернулся сегодня, и до конца дня он в строю. Со
        # смещением на день у него не оставалось активного статуса вовсе —
        # таблица показывала «Не обновлено» ровно в день выхода.
        #
        # Пересечения с завершаемым статусом не возникает: он уже COMPLETED, а
        # clean сверяется только с ACTIVE и PLANNED. В расходе за этот день
        # обе строки попадают в окно даты, и там их разводит предпочтение
        # действующего статуса (reports DataAggregator).
        if status.status_type != EmployeeStatus.StatusType.IN_SERVICE:
            self.create_status(
                employee_id=status.employee_id,
                status_type=EmployeeStatus.StatusType.IN_SERVICE,
                start_date=termination_date,
                user=user
            )

        return status

    @transaction.atomic
    def cancel_status(
        self,
        status_id: int,
        reason: str,
        user=None
    ) -> EmployeeStatus:
        """
        Отмена запланированного статуса

        Args:
            status_id: ID статуса
            reason: Причина отмены
            user: Пользователь, выполняющий отмену

        Returns:
            EmployeeStatus: Обновленный статус
        """
        try:
            status = EmployeeStatus.objects.get(pk=status_id)
        except EmployeeStatus.DoesNotExist:
            raise ValidationError(f"Статус с ID {status_id} не найден.")

        if not reason:
            raise ValidationError("Необходимо указать причину отмены.")

        status.cancel(reason, user)
        return status

    def get_employee_current_status(self, employee_id: int) -> Optional[EmployeeStatus]:
        """Статус, действующий СЕГОДНЯ. `None` — на сегодня статуса нет.

        Это НЕ то же, что «действующий статус» в списках
        (`statuses.selectors.active_status`), и разница намеренная: сюда не
        попадает статус, чей период уже прошёл, но который ещё не закрыт
        задачей `complete_expired_statuses_task`. Списку такой статус нужен —
        он подсвечивает его как просроченный; ответу на вопрос «что с
        человеком сегодня» — нет.

        Само правило живёт в `statuses.selectors.status_on_date`: здесь была
        третья копия выборки «текущего статуса», и она уже отличалась от двух
        остальных.
        """
        return status_on_date(employee_id, timezone.now().date())

    def get_employee_status_history(
        self,
        employee_id: int,
        status_type: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> QuerySet:
        """
        Получение истории статусов сотрудника

        Args:
            employee_id: ID сотрудника
            status_type: Фильтр по типу статуса
            start_date: Начало периода
            end_date: Конец периода

        Returns:
            QuerySet: Список статусов
        """
        queryset = EmployeeStatus.objects.filter(
            employee_id=employee_id,
            state__in=[
                EmployeeStatus.StatusState.COMPLETED, EmployeeStatus.StatusState.CANCELLED
            ]
        ).order_by('-end_date')

        if status_type:
            queryset = queryset.filter(status_type=status_type)

        if start_date:
            queryset = queryset.filter(start_date__gte=start_date)

        if end_date:
            queryset = queryset.filter(
                Q(end_date__lte=end_date) | Q(end_date__isnull=True)
            )

        return queryset.select_related('employee', 'related_division', 'created_by')

    def get_planned_statuses(
        self,
        employee_id: Optional[int] = None,
        division_id: Optional[int] = None
    ) -> QuerySet:
        """
        Получение запланированных статусов

        Args:
            employee_id: ID сотрудника (опционально)
            division_id: ID подразделения (опционально)

        Returns:
            QuerySet: Список запланированных статусов
        """
        queryset = EmployeeStatus.objects.filter(
            state=EmployeeStatus.StatusState.PLANNED
        )

        if employee_id:
            queryset = queryset.filter(employee_id=employee_id)

        if division_id:
            # Получаем сотрудников подразделения через StaffUnit
            from organization_management.apps.staff_unit.models import StaffUnit
            employee_ids = StaffUnit.objects.filter(
                division_id=division_id,
                employee__isnull=False
            ).values_list('employee_id', flat=True)
            queryset = queryset.filter(employee_id__in=employee_ids)

        return queryset.select_related('employee', 'related_division').order_by('start_date')

    def apply_planned_statuses(self, target_date: Optional[date] = None) -> List[EmployeeStatus]:
        """
        Применение запланированных статусов, дата начала которых наступила

        Активация — та же смена статуса, что и ручная: прежний действующий
        статус закрывается. Раньше этого шага не было, и наутро после
        запланированного отпуска у человека оказывалось ДВА активных статуса —
        отпуск и оставшееся «В строю». Правило «один активный статус» держалось
        только на ручном пути.

        Уже истёкшие плановые строки (конец периода раньше даты применения) не
        активируются: включать статус, чтобы тут же его завершить, значит
        оставить в истории активность, которой не было.

        Args:
            target_date: Дата для применения (по умолчанию - сегодня)

        Returns:
            List[EmployeeStatus]: Список примененных статусов
        """
        if target_date is None:
            target_date = timezone.now().date()

        planned_statuses = EmployeeStatus.objects.filter(
            state=EmployeeStatus.StatusState.PLANNED,
            start_date__lte=target_date
        ).filter(
            Q(end_date__isnull=True) | Q(end_date__gte=target_date)
        ).order_by('start_date', 'id')

        applied_statuses = []
        for status in planned_statuses:
            # Каждая строка — своя точка сохранения: задача ежедневная и
            # массовая, и один сотрудник с противоречивыми данными не должен
            # оставлять без статусов всех остальных.
            try:
                with transaction.atomic():
                    self._close_active_statuses(
                        employee_id=status.employee_id,
                        start_date=status.start_date,
                        new_status_type=status.status_type,
                    )

                    status.state = EmployeeStatus.StatusState.ACTIVE
                    status.auto_applied = True
                    # История пишется ниже вручную — без этого сигнал
                    # log_status_change добавил бы вторую запись о том же.
                    status._skip_history_log = True
                    status.save()

                    # EmployeeStatus.save() выводит состояние из ФАКТИЧЕСКОЙ
                    # даты, а не из target_date: для будущей даты он вернёт
                    # статус в «запланирован». Прежний статус к этому моменту
                    # уже закрыт, и человек остался бы вообще без действующего
                    # статуса, а метод отчитался бы об успехе. Сверяемся с тем,
                    # что легло в базу, и откатываем шаг целиком.
                    status.refresh_from_db()
                    if status.state != EmployeeStatus.StatusState.ACTIVE:
                        raise ValidationError(
                            f"Статус не активировался на {target_date}: "
                            f"состояние выводится из текущей даты."
                        )

                    StatusChangeHistory.objects.create(
                        status=status,
                        change_type=StatusChangeHistory.ChangeType.MODIFIED,
                        old_value='planned',
                        new_value='active',
                        comment='Статус применен автоматически'
                    )
            except ValidationError as error:
                logger.warning(
                    "Запланированный статус %s (сотрудник %s) не применён: %s",
                    status.pk, status.employee_id, error,
                )
                continue

            applied_statuses.append(status)

        return applied_statuses

    @transaction.atomic
    def complete_expired_statuses(self, target_date: Optional[date] = None) -> List[EmployeeStatus]:
        """
        Завершение статусов, срок которых истек

        Args:
            target_date: Дата для проверки (по умолчанию - сегодня)

        Returns:
            List[EmployeeStatus]: Список завершенных статусов
        """
        if target_date is None:
            target_date = timezone.now().date()

        expired_statuses = EmployeeStatus.objects.filter(
            state=EmployeeStatus.StatusState.ACTIVE,
            end_date__lt=target_date
        )

        completed_statuses = []
        for status in expired_statuses:
            status.state = EmployeeStatus.StatusState.COMPLETED
            status.save()
            completed_statuses.append(status)

            # Автоматически создаем статус "В строю" после завершения
            if status.status_type != EmployeeStatus.StatusType.IN_SERVICE:
                self.create_status(
                    employee_id=status.employee_id,
                    status_type=EmployeeStatus.StatusType.IN_SERVICE,
                    start_date=status.end_date + timedelta(days=1)
                )

        return completed_statuses

    @transaction.atomic
    def attach_document(
        self,
        status_id: int,
        title: str,
        file,
        description: str = "",
        user=None
    ) -> StatusDocument:
        """
        Прикрепление документа к статусу

        Args:
            status_id: ID статуса
            title: Название документа
            file: Файл документа
            description: Описание документа
            user: Пользователь, загрузивший документ

        Returns:
            StatusDocument: Созданный документ
        """
        try:
            status = EmployeeStatus.objects.get(pk=status_id)
        except EmployeeStatus.DoesNotExist:
            raise ValidationError(f"Статус с ID {status_id} не найден.")

        document = StatusDocument.objects.create(
            status=status,
            title=title,
            file=file,
            description=description,
            uploaded_by=user
        )

        return document

    def get_division_headcount(
        self,
        division_id: int,
        target_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        Получение расхода подразделения на определенную дату

        Args:
            division_id: ID подразделения
            target_date: Дата для расчета (по умолчанию - сегодня)

        Returns:
            Dict: Статистика по расходу
        """
        if target_date is None:
            target_date = timezone.now().date()

        # Получаем всех сотрудников подразделения
        from organization_management.apps.staff_unit.models import StaffUnit
        staff_units = StaffUnit.objects.filter(
            division_id=division_id,
            employee__isnull=False
        ).select_related('employee')

        total_count = staff_units.count()
        in_service_count = 0
        absent_by_type = {}

        for staff_unit in staff_units:
            # Получаем статус сотрудника на указанную дату
            status = EmployeeStatus.objects.filter(
                employee=staff_unit.employee,
                start_date__lte=target_date
            ).filter(
                Q(end_date__gte=target_date) | Q(end_date__isnull=True)
            ).filter(
                state__in=[EmployeeStatus.StatusState.ACTIVE, EmployeeStatus.StatusState.PLANNED]
            ).first()

            if status:
                if status.status_type == EmployeeStatus.StatusType.IN_SERVICE:
                    in_service_count += 1
                else:
                    status_display = status.get_status_type_display()
                    absent_by_type[status_display] = absent_by_type.get(status_display, 0) + 1
            else:
                in_service_count += 1

        return {
            'division_id': division_id,
            'date': target_date,
            'total_count': total_count,
            'in_service_count': in_service_count,
            'absent_count': total_count - in_service_count,
            'absent_by_type': absent_by_type
        }

    def get_absence_statistics(
        self,
        division_id: Optional[int] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> Dict[str, Any]:
        """
        Получение статистики по типам отсутствий за период и количеству штата

        Args:
            division_id: ID подразделения (опционально, если None - вся организация)
            start_date: Начало периода
            end_date: Конец периода

        Returns:
            Dict: Статистика по отсутствиям и количеству штата
        """
        if start_date is None:
            start_date = timezone.now().date() - timedelta(days=30)
        if end_date is None:
            end_date = timezone.now().date()

        # Получаем количество штата (сотрудников)
        from organization_management.apps.staff_unit.models import StaffUnit
        from organization_management.apps.divisions.models import Division

        if division_id:
            # Для конкретного подразделения и всех дочерних
            try:
                division = Division.objects.get(pk=division_id)
                # Получаем все дочерние подразделения включая само подразделение
                division_ids = list(
                    division.get_descendants(include_self=True).values_list('id', flat=True)
                )
            except Division.DoesNotExist:
                division_ids = [division_id]

            staff_count = StaffUnit.objects.filter(
                division_id__in=division_ids,
                employee__isnull=False
            ).count()

            employee_ids = StaffUnit.objects.filter(
                division_id__in=division_ids,
                employee__isnull=False
            ).values_list('employee_id', flat=True)
        else:
            # Для всей организации
            staff_count = StaffUnit.objects.filter(
                employee__isnull=False
            ).count()

            employee_ids = None

        # Статистика по статусам
        queryset = EmployeeStatus.objects.filter(
            start_date__lte=end_date
        ).filter(
            Q(end_date__gte=start_date) | Q(end_date__isnull=True)
        ).exclude(
            status_type=EmployeeStatus.StatusType.IN_SERVICE
        )

        if employee_ids is not None:
            queryset = queryset.filter(employee_id__in=employee_ids)

        # Подсчет по типам (используем код статуса на английском)
        statistics = {}
        for status_type, display_name in EmployeeStatus.StatusType.choices:
            if status_type == EmployeeStatus.StatusType.IN_SERVICE:
                continue
            count = queryset.filter(status_type=status_type).count()
            statistics[status_type] = count

        return {
            'period': {
                'start_date': start_date,
                'end_date': end_date
            },
            'division_id': division_id,
            'staff_count': staff_count,
            'total_absences': queryset.count(),
            'by_type': statistics
        }
