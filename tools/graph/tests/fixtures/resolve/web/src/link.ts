import { type Logger } from 'pino'
import { File } from 'expo-file-system'
import * as FS from 'expo-file-system'
import { Logger as OwnLogger } from './logger'

export const redirectLogger: Logger = makeLogger()

redirectLogger.info = ((orig) => orig)(redirectLogger.info)

export function logWith(l: Logger) {
  l.info('x')
}

export function logOwn(l: OwnLogger) {
  l.info('x')
}

export async function save() {
  const f = new File('a')
  await f.write('x')
  const g = new FS.File('b')
  await g.write('y')
}

export function report() {
  console.error('x')
  window.open('x')
}
