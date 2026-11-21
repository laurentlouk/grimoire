import { postTable } from '@acme/db/schema'

export const postRouter = {
  all: publicProcedure.query(() => postTable()),
} satisfies TRPCRouterRecord
