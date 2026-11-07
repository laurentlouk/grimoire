package main

import (
	"database/sql"
	"log"

	_ "github.com/lib/pq"
)

func main() {
	db, err := sql.Open("postgres", "")
	if err != nil {
		log.Fatal(err)
	}
	r := &Repo{db: db}
	if err := r.MarkShipped(1); err != nil {
		log.Fatal(err)
	}
}
