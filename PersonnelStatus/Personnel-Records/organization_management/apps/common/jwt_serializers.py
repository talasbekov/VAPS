"""JWT: КТО вошёл. Про права токен больше не рассказывает.

🔴 ПОРТАЛЬНАЯ РОЛЬ И ЕЁ ОБЛАСТЬ УБРАНЫ ИЗ ТОКЕНА (Plane №352, Ш-4).

Токен нёс `role`, `role_name`, `scope_division_id/name/level`, `scope_type`,
`scope_source`, `is_seconded`, `seconded_to_*`, `can_edit_statuses`,
`is_admin`, `is_hr_admin`, `is_observer`, `is_manager` — четырнадцать полей о
правах, посчитанных ОДИН РАЗ при входе. Это плохо не тем, что дублировало
каталог, а тем, что права в нём ЗАСТЫВАЛИ: выданная роль начинала работать
только после перелогина, а снятая продолжала действовать до истечения токена.

Права спрашиваются у `/api/operations/my-permissions/` — там они всегда
сегодняшние, и там же лежат роли раздела с их областями. Токен несёт то, что
от него и требуется: кто предъявитель.

Осталось: `username`, `email`, `is_staff`, `is_superuser` (признаки учётной
записи Django, не роли) и данные сотрудника. Ответ входа несёт `division` —
подразделение ШТАТНОЙ ЕДИНИЦЫ человека: факт о нём, а не область роли; им
подписан экран, и переживает он любую смену системы прав.
"""
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Кастомный serializer для добавления информации о роли в JWT токен
    """
    
    @classmethod
    def get_token(cls, user):
        """Добавляем дополнительные claims в токен"""
        token = super().get_token(user)
        
        # Базовая информация о пользователе
        token['username'] = user.username
        token['email'] = user.email
        token['is_staff'] = user.is_staff
        token['is_superuser'] = user.is_superuser



        # Информация о сотруднике (если есть)
        if hasattr(user, 'employee'):
            employee = user.employee
            token['employee_id'] = employee.id
            token['employee_full_name'] = f'{employee.last_name} {employee.first_name} {employee.middle_name}'
            token['employee_personnel_number'] = employee.personnel_number
        
        return token
    
    def validate(self, attrs):
        """Валидация и добавление дополнительной информации в response"""
        data = super().validate(attrs)
        
        # Добавляем информацию о пользователе в response
        user = self.user
        
        data['user'] = {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'is_staff': user.is_staff,
        }
        
        # Подразделение ШТАТНОЙ ЕДИНИЦЫ — им подписан экран. Раньше здесь
        # ехала область портальной роли (`role.scope`); роли нет, а
        # подразделение у человека есть независимо от прав.
        employee = getattr(user, 'employee', None)
        unit = getattr(employee, 'staff_unit', None) if employee else None
        division = getattr(unit, 'division', None) if unit else None
        if division is not None:
            data['user']['division'] = {
                'id': division.id,
                'name': division.name,
            }

        return data


def get_tokens_for_user(user):
    """
    Вспомогательная функция для генерации токенов для пользователя
    
    Args:
        user: Django User объект
    
    Returns:
        dict: {'refresh': '...', 'access': '...'}
    """
    refresh = RefreshToken.for_user(user)
    
    # Добавляем кастомные claims через наш serializer
    serializer = CustomTokenObtainPairSerializer()
    token = serializer.get_token(user)
    
    return {
        'refresh': str(token),
        'access': str(token.access_token),
    }
