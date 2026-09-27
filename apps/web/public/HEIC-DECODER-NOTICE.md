# HEIC decoder used by the quad labeler

The labeler loads the CSP build of `heic-to` 1.5.2 only when a browser cannot decode a HEIC photo. `heic-to` is LGPL-3.0 licensed: <https://github.com/hoppergee/heic-to>. Its bundle includes `libheif` and the HEVC decoder `libde265`; their source and license texts are at <https://github.com/strukturag/libheif> and <https://github.com/strukturag/libde265>.

The decoder is a separate, lazy-loaded browser asset. Ordinary DeckPal pages and ordinary JPEG queue work do not download it. It runs in a browser worker without script evaluation, including under the self-host content security policy. The production asset is about 3.00 MB before compression and 737 KB with gzip (measured from the web build on 2026-09-26).
