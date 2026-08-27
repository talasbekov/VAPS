"""Своя учётная запись: /api/user/profile/ и /api/user/change-password/.

ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ СТРОКИ В `views.py`. Весь `views.py` раздела
стоит на `require_permission(...)`: там нет ни одного действия, открытого
просто вошедшему. Здесь правило обратное — право не нужно, нужен сам человек,
и он может тронуть только себя. Соседство с админскими вьюхами каждый раз
провоцировало бы вопрос «а почему тут нет гейта», и однажды его бы поставили.

ПОЧЕМУ АДРЕС `/api/user/`, А НЕ `/api/operations/accounts/me/`. По этому
адресу уже стучится диалог «Редактировать профиль» в шапке клиента
(features/edit-profile) — он был написан под API, которого в бэкенде не
существовало вовсе, и обе его кнопки получали 404 (Plane №180, №181).
Из двух способов свести концы — подвинуть клиент или дать серверу тот адрес,
которого от него ждут, — выбран второй: `/api/operations/` в этом проекте
означает «поверхность раздела ОМ с гейтом admin.roles», и своя учётка,
доступная любому вошедшему, там читалась бы как исключение из правила.
"""
from django.contrib.auth import password_validation
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import translation
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from organization_management.apps.operations.services import AccountSelfService

# Язык сообщений о пароле. Валидаторы Django переведены на русский, но
# LANGUAGE_CODE проекта — 'en-us', и без этого человек читал бы «This password
# is too common». Язык переключается ТОЧЕЧНО, на время проверки: смена
# LANGUAGE_CODE проекта поменяла бы заодно все остальные ответы API, которые об
# этой задаче не просили.
MESSAGES_LANGUAGE = "ru"


class SelfProfileSerializer(serializers.ModelSerializer):
    """Свой профиль в том виде, в каком его читает диалог (UpdateProfileResponse).

    `name` собран сервером, а не склеен на клиенте: диалог показывает его в
    шапке и разбирает обратно на имя и фамилию при следующем открытии —两 два
    разных склеивания разошлись бы на людях без фамилии.
    """

    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        # Список закрыт намеренно: `username`, `is_staff`, `is_superuser` и
        # `password` сюда не входят, поэтому подсунуть их в теле нельзя — DRF
        # незнакомые ключи молча отбрасывает.
        fields = ["id", "first_name", "last_name", "email", "name"]
        read_only_fields = ["id"]

    def get_name(self, user) -> str:
        return user.get_full_name() or user.username

    def validate_email(self, value):
        """Почта уникальна среди учёток.

        Django на это не смотрит вовсе (`User.email` без `unique=True`), а по
        почте человека ищут и ею же ему пишут: две одинаковых означают, что
        письмо ушло не тому.
        """
        if not value:
            return value
        taken = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError(
                "Эта почта уже занята другой учётной записью."
            )
        return value


class ChangePasswordSerializer(serializers.Serializer):
    """Смена своего пароля: подтверждение текущим и проверки Django.

    Подтверждения нового пароля здесь НЕТ, и это не упущение: второе поле
    формы («Повторите новый пароль») существует, чтобы человек не закрепил
    опечатку, и сравнить их можно только там, где их набрали. Серверу приходит
    один пароль — тот, который человек решил поставить.
    """

    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        user = self.context["user"]
        if not user.check_password(value):
            raise serializers.ValidationError("Текущий пароль неверен.")
        return value

    def validate_new_password(self, value):
        user = self.context["user"]
        with translation.override(MESSAGES_LANGUAGE):
            try:
                password_validation.validate_password(value, user=user)
            except DjangoValidationError as exc:
                # Сообщения переводятся ВНУТРИ блока: за его границей ленивые
                # строки перевода уже развернутся по языку проекта.
                raise serializers.ValidationError(list(exc.messages))
        return value

    def validate(self, attrs):
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError(
                {"new_password": ["Новый пароль совпадает с текущим."]}
            )
        return attrs


class SelfProfileView(APIView):
    """Чтение и правка своего профиля.

    Адресата в запросе нет ВООБЩЕ — ни в пути, ни в теле: человек всегда
    правит того, кем вошёл. Это не проверка, которую можно забыть, а форма
    ручки, в которой чужую учётку нечем назвать.
    """

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=SelfProfileSerializer)
    def get(self, request):
        return Response(SelfProfileSerializer(request.user).data)

    @extend_schema(request=SelfProfileSerializer, responses=SelfProfileSerializer)
    def patch(self, request):
        form = SelfProfileSerializer(request.user, data=request.data, partial=True)
        form.is_valid(raise_exception=True)
        user = AccountSelfService.save_profile(
            request.user,
            actor=str(request.user.pk),
            **form.validated_data,
        )
        return Response(SelfProfileSerializer(user).data)


class ChangeOwnPasswordView(APIView):
    """Смена собственного пароля.

    Ограничение частоты стоит именно здесь: ручка принимает текущий пароль и
    честно отвечает, подошёл ли он, — то есть без ограничения работает как
    оракул для перебора уже угнанной сессии. Ставка своя, а не общая для API:
    пароль меняют единицы раз в год, и десяток попыток в час никого из живых
    людей не стесняет.
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "change-password"

    @extend_schema(
        request=ChangePasswordSerializer,
        responses=inline_serializer(
            name="ChangeOwnPasswordResponse",
            fields={"message": serializers.CharField()},
        ),
    )
    def post(self, request):
        form = ChangePasswordSerializer(
            data=request.data, context={"user": request.user}
        )
        form.is_valid(raise_exception=True)
        AccountSelfService.change_password(
            request.user,
            new_password=form.validated_data["new_password"],
            actor=str(request.user.pk),
        )
        # Наружу не уходит ни пароля, ни его признака — только подтверждение
        # того, что смена состоялась.
        return Response({"message": "Пароль изменён."}, status=status.HTTP_200_OK)
