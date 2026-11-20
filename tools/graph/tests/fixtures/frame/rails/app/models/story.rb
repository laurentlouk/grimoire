class Story < ApplicationRecord
  belongs_to :user
  has_many :comments, dependent: :destroy
  scope :active, -> { where(is_expired: false) }
  scope :recent, -> { active.order(created_at: :desc) }
  delegate :username, to: :user
  delegate :email, to: :user, prefix: true
  attr_accessor :vote_count
  define_method(:title_slug) { title.downcase }
  before_save :normalize_title

  def normalize_title
    self.title = title.strip
  end

  def self.hottest
    active.limit(10)
  end
end
