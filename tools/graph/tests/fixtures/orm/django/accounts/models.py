from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    nickname = models.CharField(max_length=40, blank=True, help_text="CANARY-DJANGO-HELP")
    referred_by = models.ForeignKey("self", null=True, on_delete=models.SET_NULL)
