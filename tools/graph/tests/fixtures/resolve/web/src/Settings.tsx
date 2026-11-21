import * as Button from './Button'
import { onShare } from './share'

export function Badge() {
  return <Button.Button onPress={onShare} />
}
