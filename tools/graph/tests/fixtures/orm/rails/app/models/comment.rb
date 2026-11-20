class Comment < ApplicationRecord
  belongs_to :post, class_name: "Blog::Post"
  belongs_to :user, optional: true
  belongs_to :reviewer, class_name: "User"
end
