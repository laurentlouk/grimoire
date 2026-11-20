import { Link, router } from 'expo-router'

export default function Home() {
  return (
    <Link href={{ pathname: '/post/[id]', params: { id: '1' } }}>Open</Link>
  )
}

export function openProfile(user: string) {
  router.push(`/profile/${user}`)
}
