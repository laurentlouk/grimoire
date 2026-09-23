package cart

import "example.com/shop/pricing"

type Cart struct {
	Items []int
}

func New() *Cart {
	return &Cart{}
}

func (c *Cart) Total() int {
	return pricing.Sum(c.Items)
}
