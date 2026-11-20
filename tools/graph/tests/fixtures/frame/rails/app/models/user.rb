class User < ApplicationRecord
  has_many :stories
  attr_reader :token
end
