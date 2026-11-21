class HomeController < ApplicationController
  def active
    @stories = Story.active
  end

  def show
    story = Story.find(params[:id])
    @author = story.user
    @mail = story.user_email
  end
end
