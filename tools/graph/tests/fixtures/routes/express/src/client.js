async function fetchBook(id) {
  const res = await fetch(`/api/books/${id}`, { method: 'GET' })
  return res.json()
}

module.exports = { fetchBook }
