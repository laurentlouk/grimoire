class Base:
    def save(self):
        return self.validate()

    def validate(self):
        return True


class User(Base):
    def validate(self):
        return bool(self.name)


class Ledger:
    def save_all(self):
        return True

    def get_ledger(self):
        return self

    def update(self):
        return True


class AuditLedger(Ledger):
    def update(self):
        return super().update()

    def again(self):
        return self.__class__.update(self)


class Order:
    def total_order(self):
        return 0


class Café:
    @staticmethod
    def fabrique():
        return Café()

    def servir(self):
        return 1
