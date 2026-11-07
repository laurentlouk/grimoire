import mongoose from 'mongoose'

const NoteSchema = new mongoose.Schema({
  title: { type: String, required: true },
  body: String,
  authorId: { type: String, index: true },
})

export const Note = mongoose.model('Note', NoteSchema)
