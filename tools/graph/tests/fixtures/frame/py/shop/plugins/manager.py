from .base_plugin import BasePlugin


class PluginsManager:
    def order_created(self, plugin: BasePlugin, order):
        return plugin.order_created(order, None)
