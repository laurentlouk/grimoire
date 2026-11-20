class Tag < ApplicationRecord
  has_and_belongs_to_many :posts, class_name: "Blog::Post", join_table: "blog_posts_tags", association_foreign_key: "post_id"
end
