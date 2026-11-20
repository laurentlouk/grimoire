import { postRouter } from './router/post'

export const appRouter = createTRPCRouter({
  post: postRouter,
  health: publicProcedure.query(() => ping()),
})

function ping() {
  return 'ok'
}
