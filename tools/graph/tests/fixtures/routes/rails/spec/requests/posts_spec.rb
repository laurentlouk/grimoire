require "rails_helper"

RSpec.describe "Posts", type: :request do
  it "lists the posts" do
    get "/posts"
  end

  it "publishes a post" do
    post "/posts/#{post_id}/publish"
  end

  it "links to a post" do
    expect(page).to have_link(href: "/posts/7")
  end
end
