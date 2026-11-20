class Mailer
  def key
    ENV['RUBY_KEY'] || ENV.fetch("RUBY_FETCH", 'canary-cfg-literal-8')
  end
end
