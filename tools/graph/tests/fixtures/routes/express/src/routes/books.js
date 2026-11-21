const { Router } = require('express')
const auth = require('../middleware/auth')
const { listBooks, getBook, createBook, updateCover } = require('../controllers/books')

const router = Router()

router.get('/', listBooks)
router.get('/:id', getBook)
router.post('/', auth.required, createBook)
router.route('/:id/cover').put(auth.required, updateCover)

module.exports = router
