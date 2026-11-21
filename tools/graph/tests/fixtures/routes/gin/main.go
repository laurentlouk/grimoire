package main

import (
	"github.com/gin-gonic/gin"

	"example.com/blog/articles"
	"example.com/blog/users"
)

func main() {
	r := gin.Default()
	v1 := r.Group("/api")
	users.UsersRegister(v1.Group("/users"))
	articles.ArticlesAnonymousRegister(v1.Group("/articles"))
	r.Run()
}
