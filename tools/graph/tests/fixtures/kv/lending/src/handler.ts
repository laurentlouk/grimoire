// The lending service's one handler: it records a loan in the table the template names.
export interface LoanRequest { memberId: string; bookId: string }

export async function lend(req: LoanRequest) {
  return { table: process.env.LOANS_TABLE, memberId: req.memberId, bookId: req.bookId }
}
