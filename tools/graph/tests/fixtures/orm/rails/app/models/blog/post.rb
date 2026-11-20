module Blog
  class Post < ApplicationRecord
    self.table_name = "blog_posts"

    belongs_to :author, class_name: "User"
    belongs_to :editor, class_name: "::User", optional: true
    has_many :comments, -> { order(:id) }, dependent: :destroy
    has_and_belongs_to_many :tags, join_table: "blog_posts_tags", foreign_key: "post_id"

    enum :state, { draft: "draft", published: "published" }
  end
end
