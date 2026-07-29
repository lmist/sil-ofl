# User stories

This catalog is a public, query-only font discovery and specimen application.
The following stories define its complete reachable browser and API behavior,
including loading, empty, failure, keyboard, responsive, and adversarial states.

## Arrival and shell

1. As a visitor, I can open `/` and immediately see a stable loading shell
   while interactive chunks and catalog data load.
2. As a visitor, I can identify the page from its title and level-one heading.
3. As a visitor, I can see repository, font, owner, and populated-repository
   statistics when they resolve.
4. As a visitor on a slow connection, I see loading state without layout
   collapse, duplicate controls, or unusable filters.
5. As a visitor when statistics fail, I can still use the catalog and receive a
   safe status for the failed statistic surface.
6. As a returning visitor, cached data may appear immediately and is labeled
   when it is being refreshed.

## Search

7. As a visitor, I can search by family name.
8. As a visitor, I can search by filename.
9. As a visitor, I can search by file path.
10. As a visitor, I can search by owner login.
11. As a visitor, I can search by repository full name.
12. As a fast typist, only the latest debounced search becomes current.
13. As a visitor, leading and trailing whitespace is normalized predictably.
14. As a visitor, clearing search returns to the unfiltered result set and first
    page.
15. As a visitor, Unicode, punctuation, quotes, wildcard characters, and very
    long text are handled safely without broken layout or query injection.
16. As a visitor, the search URL can be refreshed and shared.
17. As a visitor, the result count communicates searching, loading, empty, and
    resolved states without contradictory announcements.

## Filters

18. As a visitor, I can restrict results to TTF.
19. As a visitor, I can restrict results to OTF.
20. As a visitor, I can restrict results to WOFF.
21. As a visitor, I can restrict results to WOFF2.
22. As a visitor, I can return the format filter to Any.
23. As a visitor, I can filter by an exact owner.
24. As a visitor, I can set a non-negative integer minimum star threshold.
25. As a visitor, ambiguous or out-of-range star input is rejected or visibly
    normalized before it affects results.
26. As a visitor, I can toggle Webfont-only on and off repeatedly.
27. As a visitor, I can toggle Variable-only on and off repeatedly.
28. As a visitor, I can combine every compatible search, owner, format, star,
    Webfont, and Variable condition.
29. As a visitor, each active condition appears as a removable chip.
30. As a visitor, removing one chip changes only that filter and resets to the
    first result page.
31. As a visitor, Clear all removes every filter using the reset semantics
    defined in `INVARIANTS.md`.
32. As a keyboard user, I can reach, operate, and understand every field,
    select, toggle, chip, and clear action.
33. As a narrow-screen visitor, arbitrary filter values remain contained within
    the viewport.

## Sorting

34. As a visitor, I can sort by reputation descending and ascending where
    exposed.
35. As a visitor, I can sort by stars descending and ascending.
36. As a visitor, I can sort by family ascending and descending.
37. As a visitor, I can sort by identifier descending and ascending where
    exposed.
38. As a visitor, changing sort returns to the first page.
39. As a visitor, every reachable sort is visibly represented by the main sort
    control.
40. As a visitor, tied values have stable identifier ordering.
41. As a visitor, nullable and empty family values paginate without omissions or
    repetitions.

## Pagination

42. As a visitor, I can move to the next page when the API reports one.
43. As a visitor, I can return to the previous page using the local cursor
    history.
44. As a visitor, Next and Previous are unavailable when their destination is
    not valid or is still resolving.
45. As a visitor, rapid repeated activation cannot skip or duplicate a page.
46. As a visitor, page number, visible rows, cursor URL, and button availability
    always describe the same page.
47. As a visitor, changing any result criterion clears cursor history.
48. As a visitor, a valid cursor deep link loads the corresponding page or
    presents an explicit recovery if previous history cannot be reconstructed.
49. As a visitor, a malformed cursor produces a safe message and reset action.
50. As a visitor, paging preserves the selected font only when that selection
    can remain coherent under the selection contract.
51. As a visitor, the next page may be prefetched without visibly changing the
    current page.

## Result list and dense table

52. As a visitor, I can browse a virtualized standard list without rendering the
    whole result set at once.
53. As a visitor, I can switch to a dense table and back without changing
    filters, sort, page, search, or valid selection.
54. As a visitor, dense mode presents the same font records and metadata as list
    mode.
55. As a visitor, I can sort using dense column headers and see the matching
    direction in all sort controls.
56. As a visitor, an empty result set is clearly distinguished from loading and
    failure.
57. As a visitor, retained rows are labeled while a replacement request is
    pending.
58. As a visitor, a replacement failure cannot leave retained rows looking
    current.
59. As a visitor, I can retry a failed list or dense-table request.
60. As a keyboard user, native row controls retain valid semantics, focus,
    Enter activation, and advertised Space activation.
61. As a screen-reader user, the result collection has a valid name, count, and
    selection model without unsupported ARIA.
62. As a narrow-screen visitor, list content stays inside the document and dense
    columns scroll inside their own region.

## Preview, specimen, and selection

63. As a visitor, hovering or focusing a row can preview its face without
    corrupting the current selection.
64. As a visitor, I can select a font with pointer, Enter, or Space.
65. As a visitor, the selected row, URL, specimen, and use panel all identify the
    same font.
66. As a visitor, I can deselect according to the documented reset behavior.
67. As a visitor, refreshing a valid selected-font URL restores a coherent
    selection even when its row is off the current page.
68. As a visitor, an invalid, hidden, or missing selected-font URL is removed
    with a safe explanation.
69. As a visitor, I can edit the specimen phrase.
70. As a visitor, my specimen phrase remains stable while I preview or select
    fonts.
71. As a visitor, an italic face renders italic and a weighted face renders at
    its resolved weight.
72. As a visitor, I see a loading state while the selected face is fetched.
73. As a visitor, a CDN failure may fall back once to the approved raw file.
74. As a visitor, a complete face-load failure is explicit and retryable.
75. As a visitor, late completion from an older face cannot replace a newer
    preview or selection.

## Use and export

76. As a visitor with a selection, I can inspect its family, weight, style, and
    usage preview.
77. As a visitor, I can copy valid CSS for the selected face.
78. As a visitor, I can copy a valid standalone HTML example.
79. As a visitor, I can copy a valid React-oriented example.
80. As a visitor, I can copy the selected CDN URL.
81. As a visitor, I can copy the selected raw URL.
82. As a visitor, copy success appears only after the browser confirms it.
83. As a visitor, clipboard failure is communicated and can be retried.
84. As a visitor, I can download the selected font from an approved HTTPS URL.
85. As a visitor, I can open the selected repository in a safe new tab.
86. As a keyboard user, every use-panel action is reachable, visibly focused,
    and at least 24 by 24 CSS pixels.
87. As a visitor, every copied artifact continues to describe the selected font
    after hover, focus, paging, or mode changes.

## URL and navigation

88. As a visitor, documented URL-backed state round-trips through refresh.
89. As a visitor, session-only state is predictably reset on refresh.
90. As a visitor, browser Back and Forward synchronize URL-backed controls and
    results.
91. As a visitor, removing URL parameters clears their corresponding state.
92. As a visitor, duplicate, unknown, fractional, negative, or oversized URL
    values cannot create contradictory UI.
93. As a visitor to an unknown route, I receive a not-found response with a
    return-to-catalog link.

## Failure, performance, and responsive behavior

94. As a visitor, HTTP errors, GraphQL errors, malformed JSON, and offline
    failures produce safe, actionable states.
95. As a visitor, error text never exposes requests, variables, internals, SQL,
    stack traces, or credentials.
96. As a visitor, repeated filter, page, selection, and mode changes do not
    accumulate duplicate listeners, rows, or runtime errors.
97. As a visitor, expected interactions remain responsive under the documented
    performance budgets.
98. As a visitor at 320, 375, 768, 1024, or 1440 CSS pixels, every primary task
    remains reachable.
99. As a visitor at 200% zoom, text and controls do not overlap or disappear.
100. As a visitor who prefers reduced motion, non-essential transitions are
     suppressed.
101. As a visitor, normal text meets WCAG AA contrast and status is not conveyed
     by color alone.
102. As a screen-reader user, live announcements are concise and do not compete.

## GraphQL consumer

103. As a monitor, I can query process liveness without database configuration.
104. As a catalog consumer, I can query public OFL-only statistics.
105. As a catalog consumer, I can query an OFL-only font connection with
     documented filters, sorts, page bounds, total count, and page information.
106. As a catalog consumer, I can resolve one publicly visible font by a valid
     identifier.
107. As a repository consumer, I can query a filtered repository connection.
108. As a repository consumer, I can resolve a documented repository detail.
109. As a consumer, list, detail, count, and statistics visibility rules are
     consistent.
110. As a consumer, malformed identifiers, cursors, arguments, and documents
     produce safe client errors.
111. As a consumer, every sort traverses tied and nullable values without
     omission or duplication.
112. As a consumer, schema nullability and scalar ranges match returned data and
     published client contracts.
113. As a same-origin browser, I can call supported API methods under an
     explicit CORS policy.
114. As an operator, validation and execution errors are never marked for shared
     public caching.
115. As an operator, only parsed, selected, successful, anonymous GET operations
     receive the documented shared cache policy.
116. As an operator, production hides GraphiQL and unexpected internal details.
117. As an operator, bounded page size and request policy prevent unbounded
     public queries.
118. As a developer outside production, I can use GraphiQL without changing
     production security or cache behavior.
