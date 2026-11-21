class StoriesController < ApplicationController
  before_action :find_story, only: [:show]

  def new
  end

  def show
  end

  def create
    render action: :new
  end

  def find_story
  end
end
