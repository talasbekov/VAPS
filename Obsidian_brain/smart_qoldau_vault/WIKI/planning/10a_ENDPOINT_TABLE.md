# 10a — Таблица эндпоинтов (из docs/openapi.json, HEAD 310dde3)

Сгенерировано скриптом из OpenAPI 2026-09-13; security `bearer` = JwtAuthGuard/AdminJwtGuard (роль см. [[10_DOMAIN_API_AND_EVENTS]] §2), `none` = публично или вебхук с подписью. Пути с префиксом `/v1`.

| Метод | Путь | Тег | operationId | security | body | responses | summary |
|---|---|---|---|---|---|---|---|
| GET | /v1 | App | AppController_getHello | none |  | 200 |  |
| POST | /v1/admin/auth/login | admin-auth | AdminAuthController_login | none | AdminLoginDto | 200:AdminLoginResponseDto 401 | Вход сотрудника админки по email и паролю |
| POST | /v1/admin/auth/refresh | admin-auth | AdminAuthController_refresh | none | AdminRefreshDto | 200:AdminLoginResponseDto 401 | Продление сессии сотрудника. Токен ротируется: старый отзыва |
| POST | /v1/admin/auth/totp/confirm | admin-auth | AdminAuthController_totpConfirm | bearer | TotpConfirmDto | 204 | Подтверждение привязки кодом из приложения — без него 2FA не |
| POST | /v1/admin/auth/totp/setup | admin-auth | AdminAuthController_totpSetup | bearer |  | 200:TotpSetupResponseDto | Привязка второго фактора: секрет и коды восстановления отдаю |
| POST | /v1/admin/auth/totp/verify | admin-auth | AdminAuthController_totpVerify | none | TotpVerifyDto | 200:AdminLoginResponseDto | Второй шаг входа: код из приложения или одноразовый код восс |
| GET | /v1/admin/content | admin-content | ContentAdminController_list | bearer |  | 200 |  |
| POST | /v1/admin/content | admin-content | ContentAdminController_create | bearer | UpsertContentDto | 201 409 |  |
| DELETE | /v1/admin/content/{id} | admin-content | ContentAdminController_remove | bearer |  | 204 |  |
| PATCH | /v1/admin/content/{id} | admin-content | ContentAdminController_patch | bearer | PatchContentDto | 200 |  |
| POST | /v1/admin/experts/{expertId}/block | admin-verification | VerificationController_block | bearer | BlockExpertDto | 200 400 401 404 | Заблокировать эксперта (Р-19) |
| POST | /v1/admin/experts/{expertId}/unblock | admin-verification | VerificationController_unblock | bearer |  | 200 401 404 | Снять блокировку эксперта |
| GET | /v1/admin/experts/flagged | admin-verification | VerificationController_flaggedExperts | bearer |  | 200 401 | Очередь экспертов ниже порога рейтинга (Р-20): ratingCount > |
| GET | /v1/admin/payouts | admin-payouts | PayoutsAdminController_list | bearer |  | 200:AdminPayoutsListDto 401 | Очередь финконтроля выводов (по умолчанию PENDING_REVIEW, Р- |
| POST | /v1/admin/payouts/{id}/approve | admin-payouts | PayoutsAdminController_approve | bearer |  | 401 404 409 | Одобрить вывод из очереди -> PROCESSING + отправка провайдер |
| POST | /v1/admin/payouts/{id}/reject | admin-payouts | PayoutsAdminController_reject | bearer | RejectPayoutDto | 401 404 409 | Отклонить вывод с причиной -> REJECTED + возврат резерва на  |
| GET | /v1/admin/profile-moderation | admin-profile-moderation | ProfileModerationController_queue | bearer |  | 200:ModerationQueueDto 401 403 | Очередь фотографий и текстов на модерацию |
| POST | /v1/admin/profile-moderation/{expertId}/about/decision | admin-profile-moderation | ProfileModerationController_aboutDecision | bearer | ModerationDecisionDto | 200 400 401 403 404 409 | Решение по тексту «о себе»: approve/reject |
| POST | /v1/admin/profile-moderation/{expertId}/photo/decision | admin-profile-moderation | ProfileModerationController_photoDecision | bearer | ModerationDecisionDto | 200 400 401 403 404 409 | Решение по фотографии: approve/reject |
| POST | /v1/admin/reviews/{id}/resolve | admin-reviews | ReviewsAdminController_resolve | bearer | ResolveReviewDto | 200 401 404 409 | Решение по FLAGGED-отзыву: hide -> HIDDEN | restore -> PUBLI |
| GET | /v1/admin/reviews/flagged | admin-reviews | ReviewsAdminController_flagged | bearer |  | 200 401 | Очередь FLAGGED-отзывов на модерацию (админ видит всё, включ |
| GET | /v1/admin/staff | admin-staff | AdminStaffController_list | bearer |  | 200:StaffListDto 401 403 | Список сотрудников админки (SUPERADMIN) |
| POST | /v1/admin/staff | admin-staff | AdminStaffController_create | bearer | CreateStaffDto | 201:StaffDto 401 403 409 | Создать сотрудника админки (SUPERADMIN) |
| PATCH | /v1/admin/staff/{id} | admin-staff | AdminStaffController_update | bearer | UpdateStaffDto | 200:StaffCardDto 400 401 403 404 | Изменить роли и/или активность сотрудника (SUPERADMIN) |
| GET | /v1/admin/tickets | admin-tickets | TicketsAdminController_list | bearer |  | 200:AdminTicketsListDto 401 | Очередь тикетов своих команд (SUPERADMIN — все команды без о |
| GET | /v1/admin/tickets/{id} | admin-tickets | TicketsAdminController_getOne | bearer |  | 200:AdminTicketDetailDto 401 404 | Карточка тикета с перепиской и данными автора |
| POST | /v1/admin/tickets/{id}/assign | admin-tickets | TicketsAdminController_assign | bearer | AssignTicketDto | 204 401 | Назначить обращение сотруднику. Без adminUserId — себе, null |
| POST | /v1/admin/tickets/{id}/reply | admin-tickets | TicketsAdminController_reply | bearer | ReplyTicketDto | 200 401 404 409 | Ответ сотрудника: первый ответ проставляет firstReplyAt и пе |
| POST | /v1/admin/tickets/{id}/resolve | admin-tickets | TicketsAdminController_resolve | bearer |  | 200 401 404 409 | Решить тикет -> RESOLVED |
| POST | /v1/admin/verification/{expertId}/decision | admin-verification | VerificationController_decideExpert | bearer | DecisionDto | 200:ExpertMeDto 400 401 404 | Решение по анкете эксперта: approve/reject |
| POST | /v1/admin/verification/documents/{documentId}/decision | admin-verification | VerificationController_decideDocument | bearer | DecisionDto | 200 400 401 404 | Решение по документу: approve/reject |
| GET | /v1/admin/verification/queue | admin-verification | VerificationController_queue | bearer |  | 200 401 | Очередь экспертов на верификацию (PENDING) |
| POST | /v1/auth/guest | auth | AuthController_guest | none | GuestDto | 200:TokensDto 400 | Гостевой вход по deviceId |
| POST | /v1/auth/guest/convert | auth | AuthController_convertGuest | bearer | ConvertGuestDto | 200:TokensDto 400 401 403 409 | Конверсия гостя в аккаунт по телефону (Р-22) |
| POST | /v1/auth/refresh | auth | AuthController_refresh | none | RefreshDto | 200:TokensDto 401 | Обновить пару токенов по refresh-токену |
| POST | /v1/auth/request-code | auth | AuthController_requestCode | none | RequestCodeDto | 204 400 429 | Запросить SMS-код входа |
| POST | /v1/auth/verify-code | auth | AuthController_verifyCode | none | VerifyCodeDto | 200:TokensDto 400 | Подтвердить SMS-код и получить токены |
| POST | /v1/bookings | booking | BookingController_create | bearer | CreateBookingDto | 200:BookingResultDto 201:BookingResultDto 400 401 404 409 | Записаться к специалисту на слот |
| GET | /v1/consultations | consultations | ConsultationsController_list | bearer |  | 200 | Список своих консультаций (as=client|expert, default client) |
| GET | /v1/consultations/{id} | consultations | ConsultationsController_findOne | bearer |  | 200 404 | Консультация участника — клиент видит ConsultationClientDto, |
| POST | /v1/consultations/{id}/cancel | consultations | ConsultationsController_cancel | bearer |  | 200:ConsultationClientDto 403 404 409 | Отмена консультации клиентом |
| POST | /v1/consultations/{id}/cancel-by-expert | consultations | ConsultationsController_cancelByExpert | bearer |  | 200 404 409 | Отмена плановой консультации специалистом |
| POST | /v1/consultations/{id}/complete | consultations | ConsultationsController_complete | bearer | CompleteConsultationDto | 200:ConsultationExpertDto 403 404 409 | Завершение консультации экспертом с исходом (COMPLETED|CLIEN |
| POST | /v1/consultations/{id}/media-token | consultations | MediaController_mediaToken | bearer | MediaTokenRequestDto | 200:MediaTokenResponseDto 404 | LiveKit-токен для участника ACTIVE-консультации; эскалация ф |
| GET | /v1/consultations/{id}/messages | consultations | ChatController_messages | bearer |  | 200:MessageHistoryDto 404 | История сообщений чата консультации (участнику), расшифрован |
| GET | /v1/consultations/{id}/note | consultations | NotesController_getNote | bearer |  | 200:ExpertNoteDto 404 | Приватная заметка эксперта к консультации |
| PUT | /v1/consultations/{id}/note | consultations | NotesController_updateNote | bearer | UpdateExpertNoteDto | 200:ExpertNoteDto 400 404 | Создать или обновить приватную заметку эксперта |
| POST | /v1/consultations/{id}/pay | payments | PaymentsController_pay | bearer | PayConsultationDto | 200:PayResultDto 404 409 | Оплата консультации (холд) — только клиент-участник |
| GET | /v1/consultations/{id}/payment | payments | PaymentsController_getStatus | bearer |  | 200:PaymentStatusDto 404 | Статус платежа консультации — только клиент-участник |
| POST | /v1/consultations/{id}/reschedule | consultations | ConsultationsController_reschedule | bearer | RescheduleDto | 200:BookingResultDto 400 404 409 | Перенести плановую консультацию на другой слот |
| POST | /v1/consultations/{id}/review | reviews | ConsultationReviewController_create | bearer | CreateReviewDto | 200:ReviewCreatedDto 403 404 409 | Клиент оставляет отзыв на завершённую консультацию (COMPLETE |
| GET | /v1/content | content | ContentController_list | bearer |  | 200 |  |
| GET | /v1/content/{id} | content | ContentController_byId | bearer |  | 200:ContentItemDto 404 |  |
| GET | /v1/content/{id}/media | content | ContentController_media | bearer |  | 200 403 404 |  |
| POST | /v1/content/{id}/progress | content | ContentController_saveProgress | bearer | SaveProgressDto | 200 404 |  |
| POST | /v1/content/{id}/vote | content | ContentController_vote | bearer | VoteDto | 200 404 |  |
| GET | /v1/content/streak | content | ContentController_streakOf | bearer |  | 200 |  |
| DELETE | /v1/devices | devices | DevicesController_remove | bearer | RemoveDeviceDto | 204 404 | Удаление push-токена (logout устройства) |
| POST | /v1/devices | devices | DevicesController_register | bearer | RegisterDeviceDto | 201:DeviceDto | Регистрация push-токена устройства (upsert) |
| GET | /v1/experts | experts | ExpertsPublicController_list | none |  | 200 | Публичный список экспертов (VERIFIED, не заблокированные) |
| POST | /v1/experts | experts | ExpertsController_create | bearer | CreateExpertDto | 200:ExpertMeDto 400 401 403 409 | Создать анкету эксперта (Р-04) |
| GET | /v1/experts/{id} | experts | ExpertsPublicController_findOne | none |  | 200:ExpertPublicDto 404 | Публичная карточка эксперта |
| GET | /v1/experts/{id}/reviews | reviews | ExpertReviewsController_list | none |  | 200:ExpertReviewsDto | Публичные отзывы эксперта (PUBLISHED), автор анонимен, распр |
| GET | /v1/experts/{id}/slots | booking | SlotsController_list | bearer |  | 200:SlotsResponseDto 400 401 404 | Свободные слоты специалиста (горизонт 14 дней) |
| GET | /v1/experts/me | experts | ExpertsController_me | bearer |  | 200:ExpertMeDto 401 404 | Получить свою анкету эксперта |
| PATCH | /v1/experts/me | experts | ExpertsController_update | bearer | UpdateExpertDto | 200:ExpertMeDto 400 401 404 | Обновить свою анкету эксперта (Р-18) |
| PATCH | /v1/experts/me/availability | experts | ScheduleController_updateAvailability | bearer | UpdateAvailabilityDto | 200 401 404 | Переключить готовность принимать срочные заявки |
| GET | /v1/experts/me/balance | payouts | PayoutsController_balance | bearer |  | 200:BalanceDto 401 | Баланс эксперта (доступно к выводу, Р-06) |
| GET | /v1/experts/me/clients | experts | ExpertClientsController_list | bearer |  | 200 | Клиенты эксперта, давшие согласие (Р-27) |
| GET | /v1/experts/me/clients/{clientUserId} | experts | ExpertClientsController_detail | bearer |  | 200:ClientDetailDto 404 | Карточка клиента: имя и история встреч (Р-27) |
| GET | /v1/experts/me/documents | experts | DocumentsController_list | bearer |  | 200 401 404 | Список документов эксперта (4 позиции) |
| POST | /v1/experts/me/documents/{type} | experts | DocumentsController_upload | bearer | (body) | 200:ExpertDocumentDto 400 401 404 | Загрузить документ эксперта (4 типа, MinIO) |
| POST | /v1/experts/me/documents/submit | experts | DocumentsController_submit | bearer |  | 200:SubmitVerificationDto 400 401 404 | Отправить анкету на проверку (Р-14) |
| GET | /v1/experts/me/earnings | payments | EarningsController_list | bearer |  | 200:EarningsDto 401 | Начисления эксперта (Р-02) — список capture-платежей + текущ |
| GET | /v1/experts/me/earnings/daily | payments | EarningsController_daily | bearer |  | 200:DailyEarningsDto 401 | Доход эксперта по дням (Asia/Almaty) для графика |
| POST | /v1/experts/me/heartbeat | experts | ExpertsController_heartbeat | bearer |  | 204 401 404 | Heartbeat эксперта — обновить свежесть presence (E3) |
| GET | /v1/experts/me/offers | offers | OffersController_myOffers | bearer |  | 200 401 404 | Активные PENDING-офферы эксперта (без PII клиента) |
| DELETE | /v1/experts/me/photo | experts | PhotoController_remove | bearer |  | 204 401 404 | Удалить фотографию профиля |
| POST | /v1/experts/me/photo | experts | PhotoController_upload | bearer | (body) | 202:PhotoUploadedDto 400 401 404 | Загрузить фотографию профиля (на модерацию) |
| GET | /v1/experts/me/reviews | reviews | MyExpertReviewsController_myReviews | bearer |  | 200:MyExpertReviewsDto | Свои отзывы (PUBLISHED) с id — для ответа/жалобы эксперта на |
| GET | /v1/experts/me/schedule | experts | ScheduleController_getSchedule | bearer |  | 200:ScheduleResponseDto 401 404 | Получить расписание эксперта (7 дней) |
| PUT | /v1/experts/me/schedule | experts | ScheduleController_putSchedule | bearer | UpdateScheduleDto | 200:ScheduleResponseDto 400 401 404 | Задать расписание эксперта (полная замена) |
| GET | /v1/experts/me/schedule/exceptions | experts | ScheduleExceptionsController_list | bearer |  | 200 401 404 | Исключения расписания за период |
| DELETE | /v1/experts/me/schedule/exceptions/{date} | experts | ScheduleExceptionsController_remove | bearer |  | 204 401 404 | Снять исключение (идемпотентно) |
| PUT | /v1/experts/me/schedule/exceptions/{date} | experts | ScheduleExceptionsController_upsert | bearer | UpsertScheduleExceptionDto | 200:ScheduleExceptionDto 400 401 404 | Задать выходной или иные часы на дату |
| PATCH | /v1/experts/me/work-status | experts | ExpertsController_updateWorkStatus | bearer | WorkStatusDto | 200:ExpertMeDto 400 401 403 404 | Изменить рабочий статус эксперта (presence в Redis) |
| GET | /v1/favorites | favorites | FavoritesController_getFavorites | bearer |  | 200 |  |
| DELETE | /v1/favorites/{expertId} | favorites | FavoritesController_removeFromFavorites | bearer |  | 204 |  |
| PUT | /v1/favorites/{expertId} | favorites | FavoritesController_addToFavorites | bearer |  | 204 |  |
| GET | /v1/health | App | AppController_health | none |  | 200 |  |
| GET | /v1/matching/online-count | matching | MatchingController_onlineCount | bearer |  | 200:OnlineCountDto 401 | Счётчик доступных сейчас экспертов для экрана поиска (ТЗ §5. |
| DELETE | /v1/me | account | AccountController_remove | bearer |  | 204 401 404 409 | Удалить свой аккаунт и данные (ТЗ §5.1). Консультации, плате |
| GET | /v1/me | account | AccountController_profile | bearer |  | 200:ProfileDto | Свой профиль: имя и отметка согласия (Р-27) |
| POST | /v1/me/expert-visibility | account | AccountController_acceptExpertVisibility | bearer | AcceptExpertVisibilityDto | 200:ProfileDto | Согласиться, что психолог видит имя и историю встреч, и назв |
| PATCH | /v1/me/locale | devices | DevicesController_updateLocale | bearer | UpdateLocaleDto | 200 | Локаль пользователя (ru|kz) — язык уведомлений |
| GET | /v1/notifications | notifications | NotificationsController_list | bearer |  | 200:NotificationsListDto | Центр уведомлений — свои, новые сверху + бейдж |
| POST | /v1/notifications/{id}/ack | notifications | NotificationsController_ack | bearer |  | 200 404 | Подтверждение доставки пуша устройством (метрика §11.6) |
| POST | /v1/notifications/read | notifications | NotificationsController_markRead | bearer | ReadNotificationsDto | 200 | Прочитать уведомления (без ids — все свои) |
| POST | /v1/offers/{offerId}/accept | offers | OffersController_accept | bearer |  | 200:AcceptOfferDto 401 404 409 410 | Принять оффер (атомарно) |
| POST | /v1/offers/{offerId}/decline | offers | OffersController_decline | bearer |  | 200 401 404 409 410 | Отклонить оффер — заявка уходит следующему кандидату |
| GET | /v1/payment-methods | payment-methods | PaymentMethodsController_list | bearer |  | 200 |  |
| POST | /v1/payment-methods | payment-methods | PaymentMethodsController_add | bearer | AddPaymentMethodDto | 201:PaymentMethodDto |  |
| DELETE | /v1/payment-methods/{id} | payment-methods | PaymentMethodsController_remove | bearer |  | 204 404 |  |
| GET | /v1/payouts | payouts | PayoutsController_list | bearer |  | 200:PayoutsListDto 401 | Свои выводы (новые сверху) |
| POST | /v1/payouts | payouts | PayoutsController_request | bearer | RequestPayoutDto | 201:PayoutDto 401 | Заявка на вывод — минимум 10 000 ₸, автоодобрение до 300 000 |
| GET | /v1/premium | premium | PremiumController_status | bearer |  | 200:PremiumStatusDto |  |
| POST | /v1/premium/cancel | premium | PremiumController_cancel | bearer |  | 200:PremiumStatusDto 404 |  |
| GET | /v1/premium/plans | premium | PremiumPublicController_plans | none |  | 200:PremiumPlansDto | Тарифы Premium и цены (публично) |
| POST | /v1/premium/subscribe | premium | PremiumController_subscribe | bearer | SubscribeDto | 201:PremiumStatusDto 404 409 |  |
| POST | /v1/requests | requests | RequestsController_create | bearer | CreateRequestDto | 201:RequestDto 401 409 | Создать заявку на консультацию (БП-01) |
| GET | /v1/requests/{id} | requests | RequestsController_findOne | bearer |  | 200:RequestDto 401 404 | Статус своей заявки |
| POST | /v1/requests/{id}/cancel | requests | RequestsController_cancel | bearer |  | 200:RequestDto 401 404 409 | Отменить свою заявку |
| DELETE | /v1/reviews/{id} | reviews | ReviewsController_remove | bearer |  | 204 404 | Удаление своего отзыва автором-клиентом |
| POST | /v1/reviews/{id}/complaint | reviews | ReviewsController_complaint | bearer | ComplaintReviewDto | 200 404 409 | Жалоба эксперта на отзыв о себе: PUBLISHED -> FLAGGED, скрыв |
| POST | /v1/reviews/{id}/reply | reviews | ReviewsController_reply | bearer | ReplyReviewDto | 200 404 409 | Ответ эксперта на отзыв о себе (только PUBLISHED, повтор пер |
| GET | /v1/tickets | tickets | TicketsController_list | bearer |  | 200 | Мои обращения в поддержку |
| POST | /v1/tickets | tickets | TicketsController_create | bearer | CreateTicketDto | 201:TicketCreatedDto 400 | Создать обращение в поддержку. JWT необязателен: с токеном а |
| GET | /v1/tickets/{id} | tickets | TicketsController_getOne | bearer |  | 200:TicketDetailDto 404 | Своё обращение с перепиской |
| POST | /v1/tickets/{id}/reply | tickets | TicketsController_replyByAuthor | bearer | ReplyTicketDto | 204 | Ответ автора в своё обращение. Решённое -> 409: переоткрытия |
| GET | /v1/topics | topics | TopicsController_list | none |  | 200 |  |
| POST | /v1/webhooks/livekit | webhooks | LivekitWebhookController_handle | none |  | 200 | Вебхук LiveKit (без auth-guard — подпись проверяется Webhook |
| POST | /v1/webhooks/payments | webhooks | PaymentsWebhookController_handle | none |  | 200 | Вебхук платёжного провайдера (без auth-guard — подпись прове |
| POST | /v1/webhooks/payouts | webhooks | PayoutsWebhookController_handle | none |  | 200 | Вебхук payout-провайдера (без auth-guard — подпись проверяет |
