package articles

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestArticleListEndpoint(t *testing.T) {
	r := gin.New()
	ArticlesAnonymousRegister(r.Group("/api/articles"))
	req, _ := http.NewRequest("GET", "/api/articles/", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fail()
	}
}
