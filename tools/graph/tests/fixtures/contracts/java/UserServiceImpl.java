class UserServiceImpl extends UserServiceGrpc.UserServiceImplBase {
  @Override
  public void getUser(GetUserRequest request, StreamObserver<User> responseObserver) {
  }
}
