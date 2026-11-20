class User < ApplicationRecord
  belongs_to :account
  has_many :posts, class_name: "Blog::Post", foreign_key: :author_id, inverse_of: :author
  has_many :edits, class_name: "Blog::Post", foreign_key: "editor_id", dependent: :nullify
  has_many :comments
  has_many :notes, as: :notable
end

class Admin < User
  has_many :moderated, class_name: "Comment"
end
