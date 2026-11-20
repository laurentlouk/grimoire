import * as UI from '../ui'
import Card from '@components/Card'
import { atoms } from '~/alf'
import logo from '@assets/logo.png'
import data from '../data.json'
import posts from '../sql/posts.sql'
import { postTable } from '@acme/db/schema'
import { connect } from '@acme/db'
import { Button as UIButton } from '@acme/ui/button'
import { theme } from '@acme/ui'
import { appRouter } from '@acme/api'

export default () => (
  <UI.Row>
    <Card />
    <UIButton />
    <div>{postTable()}</div>
  </UI.Row>
)

export function useHome() {
  return [atoms(), connect(), theme, logo, data, posts, appRouter]
}
