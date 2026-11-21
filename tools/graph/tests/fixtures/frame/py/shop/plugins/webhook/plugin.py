from ..base_plugin import BasePlugin


class WebhookPlugin(BasePlugin):
    def order_created(self, order, previous_value):
        return previous_value
