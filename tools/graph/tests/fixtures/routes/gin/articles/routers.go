package articles

import "github.com/gin-gonic/gin"

func ArticlesAnonymousRegister(router *gin.RouterGroup) {
	router.GET("/", ArticleList)
	router.GET("/:slug", ArticleRetrieve)
}

func ArticleList(c *gin.Context) {
	c.JSON(200, gin.H{"articles": []string{}})
}

func ArticleRetrieve(c *gin.Context) {
	c.JSON(200, gin.H{"article": c.Param("slug")})
}
