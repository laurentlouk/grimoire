package pricing

func Sum(xs []int) int {
	t := 0
	for _, x := range xs {
		t += x
	}
	return t
}
