export const authRouter = createTRPCRouter({
  getSession: publicProcedure.query(() => 1),
})
