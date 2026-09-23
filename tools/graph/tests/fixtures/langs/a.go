package shapes
import (
  "fmt"
  u "github.com/acme/app/util"
)
type Shape interface { Area() float64 }
type Circle struct { R float64 }
func (c *Circle) Area() float64 { return u.Helper(c.R) }
func Run() { c := &Circle{}; c.Area(); fmt.Println("x"); helper() }
