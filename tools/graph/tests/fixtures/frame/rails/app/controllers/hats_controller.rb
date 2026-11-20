class HatsController < ApplicationController
  def index
    @hats = Hat.active
    @all = Hat.where(id: 1)
  end
end
