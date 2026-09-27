# HEIC decoder used by the quad labeler

The labeler loads `heic2any` 0.0.4 only when a browser cannot decode a HEIC photo. The `heic2any` wrapper is MIT licensed: <https://github.com/alexcorvi/heic2any>. Its distributed bundle includes `libheif` and its HEVC decoder, which carry LGPL-3.0 terms: <https://github.com/strukturag/libheif> and <https://github.com/strukturag/libde265>. Those upstream repositories provide the corresponding source and license texts.

The decoder is a separate, lazy-loaded browser asset. Ordinary DeckPal pages and ordinary JPEG queue work do not download it. The production asset is about 1.35 MB before compression and 345 KB with gzip (measured from the web build on 2026-09-26).
