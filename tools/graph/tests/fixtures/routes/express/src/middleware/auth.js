function required(req, res, next) {
  if (!req.headers.authorization) return res.status(401).end()
  next()
}

module.exports = { required }
