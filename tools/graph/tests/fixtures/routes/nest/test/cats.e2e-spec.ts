import * as request from 'supertest'

describe('cats', () => {
  it('finds one cat', () => {
    return request(server).get('/api/cats/42').expect(200)
  })
})
