package builder

type Builder struct{}

func NewBuilder() *Builder {
	return &Builder{}
}

func (b *Builder) BuildThing() int {
	return 1
}

func Build() int {
	return NewBuilder().BuildThing()
}
