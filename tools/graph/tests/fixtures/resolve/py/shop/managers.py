class ProductsQueryset:
    def annotate_is_published(self, channel):
        return self

    def annotate_published_at(self, channel):
        return self

    def annotate_publication_info(self, channel):
        return self.annotate_is_published(channel).annotate_published_at(channel)

