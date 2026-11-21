export async function loadUsers() {
  const res = await fetch('/api/users')
  return res.json()
}

export async function addUser(user: unknown) {
  return fetch('/api/users', { method: 'POST', body: JSON.stringify(user) })
}
