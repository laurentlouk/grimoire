from typing import Callable


class BasePlugin:
    order_created: Callable[["Order", None], None]
    order_updated: Callable[["Order", None], None]

    def notify(self, order):
        return self.order_created(order, None)
