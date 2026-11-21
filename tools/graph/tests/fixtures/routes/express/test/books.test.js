const request = require('supertest')
const app = require('../src/app')

describe('books', () => {
  it('lists the books', async () => {
    await request(app).get('/api/books').expect(200)
  })
})

async function testCover(id) {
  await request(app).put('/api/books/' + id + '/cover').expect(200)
}

module.exports = { testCover }
