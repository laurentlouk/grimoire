require "rails_helper"

RSpec.describe "Posts", type: :request do
  it "lists the posts" do
    get "/posts"
  end

  it "publishes a post" do
    post "/posts/#{post_id}/publish"
  end
end
