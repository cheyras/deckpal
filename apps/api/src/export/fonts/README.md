These static font files are embedded in printable PDFs. Fraunces and Figtree
were instantiated from the variable fonts already used by `apps/web`.
The three Noto files are subsets for catalog symbols missing from those faces:
Noto Sans Symbols (♀ ♂), Noto Sans (δ), and Noto Sans Symbols 2 (☆ ◇).
Each font's SIL Open Font License is beside it. The source files are from
Google Fonts; the subsets were made with fontTools.

`../assets/deckpal-logo-dark.svg` is a copy of
`apps/web/public/logo/deckpal-logo-dark.svg`, used by svg-to-pdfkit so the
print mark remains vector. Keep the two copies in sync when the logo changes.
