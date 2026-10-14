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

    def update(self):
        return True


class AuditLedger(Ledger):
    def update(self):
        return super().update()
