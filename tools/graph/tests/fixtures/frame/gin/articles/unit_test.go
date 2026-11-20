package articles

import "testing"

func TestArticles(t *testing.T) {
	r := gin.New()
	RegisterArticleRoutes(r.Group("/api"))
}
