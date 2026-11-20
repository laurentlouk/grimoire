# This file is auto-generated from the current state of the database.
ActiveRecord::Schema[7.1].define(version: 2024_05_02_101500) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pgcrypto"
  enable_extension "plpgsql"

  create_enum "post_state", ["draft", "published", "archived"]

  create_table "accounts", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "name", limit: 80, null: false
    t.string "plan", default: "CANARY-RAILS-DEFAULT", null: false, comment: "CANARY-RAILS-COMMENT"
    t.decimal "balance", precision: 10, scale: 2, default: 0
    t.boolean "active", default: true, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
  end

  create_table "users", force: :cascade do |t|
    t.uuid "account_id", null: false
    t.string "email", null: false
    t.string "roles", default: [], array: true
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index "lower((email)::text)", name: "index_users_on_lower_email", unique: true
    t.index ["account_id"], name: "index_users_on_account_id"
  end

  create_table "blog_posts", force: :cascade do |t|
    t.bigint "author_id", null: false
    t.bigint "editor_id"
    t.string "title", null: false
    t.enum "state", default: "draft", null: false, enum_type: "post_state"
    t.virtual "slug", type: :string, as: "lower((title)::text)", stored: true
    t.datetime "published_at"
    t.index ["author_id"], name: "index_blog_posts_on_author_id"
    t.index ["published_at"], name: "index_blog_posts_on_published_at", where: "(state = 'CANARY-RAILS-WHERE'::post_state)"
  end

  create_table "comments", force: :cascade do |t|
    t.bigint "post_id", null: false
    t.bigint "user_id"
    t.text "body"
    t.index ["post_id"], name: "index_comments_on_post_id"
  end

  create_table "tags", force: :cascade do |t|
    t.string "name", null: false
  end

  create_table "blog_posts_tags", id: false, force: :cascade do |t|
    t.bigint "post_id", null: false
    t.bigint "tag_id", null: false
    t.index ["post_id", "tag_id"], name: "index_blog_posts_tags_on_post_id_and_tag_id", unique: true
  end

  create_table "memberships", primary_key: ["account_id", "user_id"], force: :cascade do |t|
    t.uuid "account_id", null: false
    t.bigint "user_id", null: false
    t.string "role", null: false
  end

  add_foreign_key "users", "accounts", on_delete: :cascade
  add_foreign_key "blog_posts", "users", column: "author_id"
  add_foreign_key "comments", "blog_posts", column: "post_id", on_delete: :cascade
  add_foreign_key "memberships", "accounts"
end
