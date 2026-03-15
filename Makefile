.PHONY: test coverage check

test:
	node --test

coverage:
	node --test \
		--experimental-test-coverage \
		--test-coverage-exclude='tests/**' \
		--test-coverage-branches=90

check:
	node --check index.js
