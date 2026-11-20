package users

import "github.com/gin-gonic/gin"

func UsersRegister(router *gin.RouterGroup) {
	router.POST("/login", AuthRequired, UsersLogin)
	router.POST("/", UsersRegistration)
}

func AuthRequired(c *gin.Context) {
	c.Next()
}

func UsersLogin(c *gin.Context) {
	c.JSON(200, gin.H{})
}

func UsersRegistration(c *gin.Context) {
	c.JSON(201, gin.H{})
}
