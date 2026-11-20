import user_pb2_grpc


class UserService(user_pb2_grpc.UserServiceServicer):
    def GetUser(self, request, context):
        return None

    def helper(self):
        return 1


class BaseUsers(user_pb2_grpc.UserServiceServicer):
    def Check(self, request, context):
        return None


class Users(BaseUsers):
    def ListUsers(self, request, context):
        return []
