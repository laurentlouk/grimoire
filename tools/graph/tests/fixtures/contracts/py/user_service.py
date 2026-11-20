import user_pb2_grpc


class UserService(user_pb2_grpc.UserServiceServicer):
    def GetUser(self, request, context):
        return None

    def helper(self):
        return 1
