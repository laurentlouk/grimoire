class File {
  write = jest.fn()
}

class Window {
  open = jest.fn()
}

module.exports = { File, Window }
