class Delegating:
    def __init__(self, repo):
        self.repo = repo

    def annotate_published_at(self, channel):
        return self.repo.annotate_published_at(channel)
