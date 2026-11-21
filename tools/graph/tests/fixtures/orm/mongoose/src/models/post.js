const mongoose = require('mongoose')

const postSchema = new mongoose.Schema({
  title: { type: String, required: [true, 'CANARY-MONGOOSE-MESSAGE'] },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  comments: [{ body: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
})

const categorySchema = new mongoose.Schema({ label: String }, { collection: 'taxonomy' })

module.exports = {
  Post: mongoose.model('Post', postSchema),
  Category: mongoose.model('Category', categorySchema),
}
