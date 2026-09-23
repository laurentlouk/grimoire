class Base:
    def save(self):
        return self.validate()

    def validate(self):
        return True


class User(Base):
    def validate(self):
        return bool(self.name)
