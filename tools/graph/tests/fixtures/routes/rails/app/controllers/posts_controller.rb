class PostsController < ApplicationController
  def index
    @posts = []
  end

  def show
  end

  def new
  end

  def create
  end

  def edit
  end

  def update
  end

  def destroy
  end

  def archive
  end

  def publish
    redirect_to "/posts/#{params[:id]}"
  end
end
