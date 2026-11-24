.PHONY: check test test/node test/bun

check: test/node test/bun

test: check

test/node:
	node --test test/conformance.test.ts

test/bun:
	bun test
