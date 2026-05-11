# Changelog

## [1.1.0](https://github.com/glorioustephan/todoist-autolabel-service/compare/todoist-autolabel-v1.0.0...todoist-autolabel-v1.1.0) (2026-05-11)


### Features

* **sync:** backfill previously-failed Inbox tasks on start and on a slow sweep ([69afd86](https://github.com/glorioustephan/todoist-autolabel-service/commit/69afd8626cf6bdcaf29fa944725e2fe88c21b03a))
* **sync:** retry previously-failed Inbox tasks on boot and on a slow sweep ([d3ee142](https://github.com/glorioustephan/todoist-autolabel-service/commit/d3ee142be588c03f97d26d6653b665b66764f6ae))

## 1.0.0 (2026-05-11)


### ⚠ BREAKING CHANGES

* prepare for npm publication as @glorioustephan/todoist-autolabel

### Features

* **cli:** let consumers point at their own labels file ([f950f3a](https://github.com/glorioustephan/todoist-autolabel-service/commit/f950f3a5624cec2c8beda60a3a5ad8a8a8c16fa9))
* default to Claude Haiku 4.5 for classification ([92deab4](https://github.com/glorioustephan/todoist-autolabel-service/commit/92deab401a82e6db97f66778b935abd5c7e8874d))
* **docs:** publish docs to GitHub Pages via a Jekyll workflow ([32f48f7](https://github.com/glorioustephan/todoist-autolabel-service/commit/32f48f795b1b2d638238991c62c1062441a4a49d))
* migrate from deprecated @doist/todoist-api-typescript to @doist/todoist-sdk ([0bd5d3e](https://github.com/glorioustephan/todoist-autolabel-service/commit/0bd5d3eab3abf86c78ac2306d02ae2892c63c998))
* prepare for npm publication as @glorioustephan/todoist-autolabel ([fd1ea83](https://github.com/glorioustephan/todoist-autolabel-service/commit/fd1ea8372dd5a80cdc45e258c773ce8674ba81da))


### Bug Fixes

* **deps:** align engines with @doist/todoist-sdk Node &gt;=20.18.1 ([cab4807](https://github.com/glorioustephan/todoist-autolabel-service/commit/cab4807279c3a0e532adf6e1bfddf42576879330))
* **scripts:** restore PM2 scripts and add a `prepare` build hook ([0ade110](https://github.com/glorioustephan/todoist-autolabel-service/commit/0ade11014351ead8f4dfc94676d412b2f69e3c71))
