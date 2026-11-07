import postgres from 'postgres'

// one pool for the web service; the queries tag their SQL with it
export const sql = postgres({ max: 4 })
