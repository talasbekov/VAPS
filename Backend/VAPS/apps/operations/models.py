from django.db import models


class TimeStampedModel(models.Model):
    """Integer-PK base with timestamps. Operations surrogate-PK tables use this.

    Deliberately does NOT subclass core's UUIDTimeStampedModel: operations
    surrogate PKs are integer BigAutoField (project decision), while
    cross-context reference columns remain UUIDField.
    """

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
