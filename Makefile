.PHONY: test coverage check

test:
	node --test tests/index.test.js

coverage:
	node --test tests/index.test.js \
		--experimental-test-coverage \
		--test-coverage-include='tests/**' \
		--test-coverage-branches=90

check:
	node --check tests/index.test.js
