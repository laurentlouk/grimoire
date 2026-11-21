export const useStore = create<State>()((set) => ({ n: count() }))

function count() {
  return 0
}
