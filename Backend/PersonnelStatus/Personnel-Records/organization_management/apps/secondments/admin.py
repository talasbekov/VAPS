from organization_management.admin_auto import register_allowed  # noqa: E402

# Архивный двойник: действующее прикомандирование живёт в operations.Secondment.
register_allowed("secondments", ())
