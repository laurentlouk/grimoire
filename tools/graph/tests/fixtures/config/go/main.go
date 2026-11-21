package main

import "os"

type Config struct {
	Port string `env:"GO_PORT" envDefault:"canary-cfg-literal-6"`
}

func main() {
	_ = os.Getenv("GO_HOST")
}
