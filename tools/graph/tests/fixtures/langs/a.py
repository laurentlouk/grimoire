import os.path
from .util import helper, Other as O
from pkg.mod import thing
class Circle(Base, Shape):
    def area(self):
        return helper(self.r)
    @staticmethod
    def make(): return Circle()
def run(x):
    c = Circle(); c.area(); os.path.join("a")
