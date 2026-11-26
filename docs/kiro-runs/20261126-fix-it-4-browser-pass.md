# fix-it task 4: browser pass (Playwright, production build, /api/scan and /api/fix mocked)
Script: /workspace/qa-tools/fixpanel.mjs. Viewports 1280, 390, 320; Daylight at 390; reduced motion at 1280. Fake token built at run time.

w1280 button visible: true
w1280 focus on token field: fix-token
w1280 dialog name: fix-title / Open a pull request
w1280 token field type: password autocomplete off label GitHub token
w1280 focus never reaches the page behind (inert background): true
w1280 no horizontal scroll: true
w1280 Esc closed: true focus back on button: Open a pull request
w1280 alert: The token cannot push to owner/repo. If you cannot push to this repository, fork it and scan the fork.
w1280 token cleared after error: true
w1280 live region present: 1
w1280 success text: The dead rest; review the pull request. | link https://github.com/owner/repo/pull/7 target _blank rel noopener | focused link: true
w1280 axe violations: []
w1280 token in storage/cookie/url: false | in console: false | console msgs: 1 ["error:Failed to load resource: the server responded with a status of 403 (Forbidden)"]
w390 button visible: true
w390 focus on token field: fix-token
w390 dialog name: fix-title / Open a pull request
w390 token field type: password autocomplete off label GitHub token
w390 focus never reaches the page behind (inert background): true
w390 no horizontal scroll: true
w390 alert: The token cannot push to owner/repo. If you cannot push to this repository, fork it and scan the fork.
w390 token cleared after error: true
w390 live region present: 1
w390 success text: The dead rest; review the pull request. | link https://github.com/owner/repo/pull/7 target _blank rel noopener | focused link: true
w390 axe violations: []
w390 token in storage/cookie/url: false | in console: false | console msgs: 1 ["error:Failed to load resource: the server responded with a status of 403 (Forbidden)"]
w320 button visible: true
w320 focus on token field: fix-token
w320 dialog name: fix-title / Open a pull request
w320 token field type: password autocomplete off label GitHub token
w320 focus never reaches the page behind (inert background): true
w320 no horizontal scroll: true
w320 alert: The token cannot push to owner/repo. If you cannot push to this repository, fork it and scan the fork.
w320 token cleared after error: true
w320 live region present: 1
w320 success text: The dead rest; review the pull request. | link https://github.com/owner/repo/pull/7 target _blank rel noopener | focused link: true
w320 axe violations: []
w320 token in storage/cookie/url: false | in console: false | console msgs: 1 ["error:Failed to load resource: the server responded with a status of 403 (Forbidden)"]
w390-day button visible: true
w390-day focus on token field: fix-token
w390-day dialog name: fix-title / Open a pull request
w390-day token field type: password autocomplete off label GitHub token
w390-day focus never reaches the page behind (inert background): true
w390-day no horizontal scroll: true
w390-day alert: The token cannot push to owner/repo. If you cannot push to this repository, fork it and scan the fork.
w390-day token cleared after error: true
w390-day live region present: 1
w390-day success text: The dead rest; review the pull request. | link https://github.com/owner/repo/pull/7 target _blank rel noopener | focused link: true
w390-day axe violations: []
w390-day token in storage/cookie/url: false | in console: false | console msgs: 1 ["error:Failed to load resource: the server responded with a status of 403 (Forbidden)"]
w1280-rm button visible: true
w1280-rm focus on token field: fix-token
w1280-rm dialog name: fix-title / Open a pull request
w1280-rm token field type: password autocomplete off label GitHub token
w1280-rm focus never reaches the page behind (inert background): true
w1280-rm no horizontal scroll: true
w1280-rm alert: The token cannot push to owner/repo. If you cannot push to this repository, fork it and scan the fork.
w1280-rm token cleared after error: true
w1280-rm live region present: 1
w1280-rm success text: The dead rest; review the pull request. | link https://github.com/owner/repo/pull/7 target _blank rel noopener | focused link: true
w1280-rm axe violations: []
w1280-rm animation-duration on open dialog: 1e-06s
w1280-rm token in storage/cookie/url: false | in console: false | console msgs: 1 ["error:Failed to load resource: the server responded with a status of 403 (Forbidden)"]
requests sent 10 each body keys: paths,replacements,repo,token | repo: owner/repo

Note: the single console message per run is the browser's own line for the mocked 403 answer; it holds no token. Focus check: Tab never lands on the page behind the dialog (it may leave to browser chrome, which shows as body).
