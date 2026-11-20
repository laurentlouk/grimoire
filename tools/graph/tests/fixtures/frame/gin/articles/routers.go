package articles

import "github.com/gin-gonic/gin"

func RegisterArticleRoutes(router *gin.RouterGroup) {
	router.GET("/", ArticleList)
	router.GET("/:slug", ArticleRetrieve)
}

func ArticleList(c *gin.Context) {
	c.JSON(200, nil)
}

func ArticleRetrieve(c *gin.Context) {
	c.JSON(200, nil)
}

func ArticleDelete(c *gin.Context) {
	c.JSON(200, nil)
}
