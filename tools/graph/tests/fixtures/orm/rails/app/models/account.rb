class Account < ApplicationRecord
  has_many :users, dependent: :destroy
  has_many :memberships
  has_many :members, through: :memberships, source: :user

  validates :name, presence: true
end
