export class GifView {
  nativeRef: any

  playAsync() {
    return this.nativeRef.current.playAsync()
  }

  render() {
    return this.chain().playAsync()
  }

  chain() {
    return this
  }
}
