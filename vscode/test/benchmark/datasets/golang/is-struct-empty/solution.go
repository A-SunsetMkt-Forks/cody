package main

import (
	"fmt"
)

func isEmptyStruct(r Response) bool {
	return r == Response{}
}

func main() {
	if isEmptyStruct(work()) {
		fmt.Println("empty")
	} else {
		fmt.Println("not empty")
	}
}
