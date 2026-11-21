const express = require('express')
const books = require('./routes/books')

const app = express()
app.use(express.json())
app.use('/api/books', books)
app.get('/health', (req, res) => res.send('ok'))

module.exports = app
