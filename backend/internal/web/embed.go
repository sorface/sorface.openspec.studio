package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed dist
var assets embed.FS

func Handler() http.Handler {
	subtree, err := fs.Sub(assets, "dist")
	if err != nil {
		panic(err)
	}
	files := http.FileServer(http.FS(subtree))

	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestPath := strings.TrimPrefix(path.Clean(request.URL.Path), "/")
		if requestPath == "." {
			requestPath = "index.html"
		}
		if _, err := fs.Stat(subtree, requestPath); err != nil {
			request.URL.Path = "/"
		}
		files.ServeHTTP(response, request)
	})
}
