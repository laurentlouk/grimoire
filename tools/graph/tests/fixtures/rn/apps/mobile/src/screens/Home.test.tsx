import Home from './Home'

it('renders', () => {
  const Framed = memo(function Framed() {
    return <Home />
  })
  render(<Framed />)
})
