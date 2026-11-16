# Testing

Property-based tests first for pure logic (fast-check).

## Required properties
- URL canonicalisation is idempotent
- Snapshot picker returns the latest snapshot ≤ citation date, or none
- Classifier never labels a 2xx with matching content as dead
- Patch output changes only the targeted URLs

## Hooks
- On save in `lib/classify/**`, run the PBT suite
- On save of `*.md`, dogfood a Lychgate scan of our own docs via MCP
- Pre-commit secret scan
- On task complete, update the spec checklist and changelog

## QA bar
Desktop 1280 and mobile 390/320; Lighthouse a11y ≥ 95 in Daylight mode; suite green.
