import { forwardRef } from 'react'

export const MentionList = forwardRef(function MentionListImpl(props: any, ref: any) {
  const selectItem = (index: number) => index
  const enterHandler = () => {
    selectItem(0)
  }
  function Row() {
    return null
  }
  return <Row onPress={enterHandler} />
})
