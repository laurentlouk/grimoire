require_relative 'util'
require 'json'
module Geo
  class Circle < Base
    include Shape
    def area
      helper(@r)
    end
    def self.make; Circle.new; end
  end
end
def run; c = Geo::Circle.new; c.area; puts "x"; end
