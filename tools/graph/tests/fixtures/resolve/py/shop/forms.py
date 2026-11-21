from django.db import models


class BaseForm:
    def clean(self):
        return 1


class AddressForm(BaseForm):
    def clean(self):
        return super().clean()


class OtherForm:
    def clean(self):
        return 2


class Order(models.Model):
    def save(self):
        return super().save()


class Repo:
    def save(self):
        return 3
