package server

import pb "example.com/acme/users/v1"

type userServer struct {
	pb.UnimplementedUserServiceServer
}

func (s *userServer) ListUsers(req *pb.ListUsersRequest, stream pb.UserService_ListUsersServer) error {
	return nil
}
