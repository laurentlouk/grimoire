import graphene
import strawberry


class CreatePost(graphene.Mutation):
    def mutate(self, info, title):
        return None


class PostMutations(graphene.ObjectType):
    create_post = CreatePost.Field()


class UserQueries(graphene.ObjectType):
    def resolve_viewer(root, info):
        return None


class Post(graphene.ObjectType):
    def resolve_title(root, info):
        return root.title


@strawberry.type
class Query:
    @strawberry.field
    def all_posts(self) -> list:
        return []
