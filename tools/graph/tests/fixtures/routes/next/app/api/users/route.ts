export async function GET(request: Request) {
  return Response.json([])
}

export async function POST(request: Request) {
  return Response.json({}, { status: 201 })
}
