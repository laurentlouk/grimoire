import { Button } from './Button'
import { Button as Shared, Span } from '@acme/ui'

export default function Card() {
  return (
    <Button>
      <Span>go</Span>
      <Shared />
    </Button>
  )
}
