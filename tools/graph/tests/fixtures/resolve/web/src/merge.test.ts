import { get } from './helpers'

it('restores the spy', async () => {
  const get = jest.spyOn(api, 'get')
  try {
    expect(1).toBe(1)
  } finally {
    get.mockRestore()
  }
})
