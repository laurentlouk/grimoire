import uuid

from django.conf import settings
from django.db import models
from core.models import TimeStamped


class Order(TimeStamped):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="orders")
    number = models.CharField(max_length=20)
    note = models.TextField(null=True, blank=True)

    class Meta:
        unique_together = ("customer", "number")
        constraints = [
            models.UniqueConstraint(fields=["number"], condition=models.Q(note__isnull=True), name="order_number_open"),
            models.CheckConstraint(check=models.Q(number__gt=""), name="order_number_set"),
        ]


class OrderLine(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey("store.Product", on_delete=models.PROTECT, db_constraint=False)
    quantity = models.PositiveSmallIntegerField(default=1)


class GiftOrder(Order):
    message = models.TextField()


class RecentOrder(Order):
    class Meta:
        proxy = True
