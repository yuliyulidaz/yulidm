# Vendored browser assets

These files are served locally; no CDN request is made at runtime.

- html2canvas 1.4.1: MIT (`html2canvas/LICENSE`)
- Cropper.js 1.5.13: MIT (`cropperjs/LICENSE`)
- fflate 0.8.2 UMD build: MIT (`fflate/LICENSE`)
- Font Awesome Free 6.0.0: icons CC BY 4.0, fonts SIL OFL 1.1, code MIT (`fontawesome-free/LICENSE.txt`)
- Inter Latin fonts, packaged by @fontsource/inter 4.5.15: SIL OFL 1.1 (`inter/LICENSE.txt`, from rsms/inter v3.19)

`manifest.json` records the registry archive URLs, npm SHA-512 integrity values verified by npm during installation, and SHA-256 hashes of the copied files. Browser assets were copied from these exact packages with install scripts disabled. Only the required distributions, font files, and licenses are included. Preserve license files when updating. Font Awesome's CSS also names legacy font formats; the bundled WOFF2 format is supported by modern browsers.
