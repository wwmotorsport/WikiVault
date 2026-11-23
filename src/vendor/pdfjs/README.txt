PDF.js 3.11.174, by Mozilla and the PDF.js contributors, under the Apache License 2.0 (see LICENSE).
https://github.com/mozilla/pdf.js

pdf.js and pdf.worker.js are the unmodified "legacy" builds from the pdfjs-dist 3.11.174 package.
Wikivault uses them to read the text of PDF pages (src/core/pdf-text.js) and, for the Survival Guides, to read
a page's layout and draw it in a window that is never shown (src/renderer/guide-convert.js). They are kept here
as files, rather than installed as a package, because the package asks for an optional native
drawing library that Wikivault does not use and should not ship.
