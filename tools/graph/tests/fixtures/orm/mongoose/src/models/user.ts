import { Schema, model } from 'mongoose'

const addressSchema = new Schema({ street: String, city: { type: String, required: true } }, { _id: false })

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    name: String,
    role: { type: String, default: 'CANARY-MONGOOSE-DEFAULT', enum: ['CANARY-MONGOOSE-ENUM', 'admin'] },
    karma: { type: Number, default: 0 },
    address: addressSchema,
    profile: {
      bio: String,
      links: [String],
    },
  },
  { timestamps: true },
)
userSchema.index({ name: 1, karma: -1 })

export const User = model('User', userSchema)
