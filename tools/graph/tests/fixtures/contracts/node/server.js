const grpc = require('@grpc/grpc-js')

function getUser(call, callback) {
  callback(null, {})
}

class Handlers {
  static listAll(call) {
    call.end()
  }
}

function main() {
  const server = new grpc.Server()
  server.addService(proto.acme.UserService.service, { getUser, listUsers: Handlers.listAll.bind(null), inline: () => null })
}
