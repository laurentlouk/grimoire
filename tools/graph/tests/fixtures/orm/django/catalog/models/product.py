from django.db import models
from core.models import TimeStamped


class Tag(models.Model):
    slug = models.SlugField(unique=True)


class Product(TimeStamped):
    sku = models.CharField("SKU", max_length=32, unique=True)
    title = models.CharField(max_length=200, verbose_name="CANARY-DJANGO-VERBOSE")
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=10, default="CANARY-DJANGO-DEFAULT", choices=[("CANARY-DJANGO-CHOICE", "x")])
    stock = models.PositiveIntegerField(db_default=0)
    tags = models.ManyToManyField(Tag, blank=True)

    class Meta:
        db_table = "catalog_product"
        indexes = [models.Index(fields=["-created_at"], name="product_recent_idx")]
