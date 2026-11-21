const store = new Map()

function listBooks(req, res) {
  res.json([...store.values()])
}

function getBook(req, res) {
  res.json(store.get(req.params.id) || null)
}

function createBook(req, res) {
  store.set(req.body.id, req.body)
  res.status(201).json(req.body)
}

function updateCover(req, res) {
  res.json({ id: req.params.id })
}

module.exports = { listBooks, getBook, createBook, updateCover }
