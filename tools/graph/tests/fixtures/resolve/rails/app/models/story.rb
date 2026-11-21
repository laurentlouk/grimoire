class Story < ApplicationRecord
  has_many :votes
  has_many :voters, through: :votes, source: :user
  before_save :normalize_title, if: :published?
  scope :by_title, -> { group(:title) }
  scope :preloaded, -> { preload(:votes, hidings: :user) }

  def normalize_title
    respond_to?(:published?)
  end

  def published?
    true
  end

  def user
    nil
  end

  def title
    nil
  end
end
