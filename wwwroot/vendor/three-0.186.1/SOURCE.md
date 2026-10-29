# Three.js for the hotel hero

- Upstream: https://github.com/mrdoob/three.js
- Package: `three@0.186.1`, MIT (see LICENSE).
- Package download: https://registry.npmjs.org/three/-/three-0.186.1.tgz
- Verified package integrity: `sha512-blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA==`
- `three.hotel.min.js` is an ES module bundle generated with esbuild 0.25.12, using `--bundle --minify --format=esm --legal-comments=inline`.
- Entry exports from the official `build/three.module.js`: REVISION, WebGLRenderer, NoToneMapping, Scene, PerspectiveCamera, Color, PlaneGeometry, ShaderMaterial, FrontSide, Mesh, BufferGeometry, BufferAttribute, Points, Timer, Vector3.
- Bundle SHA-256: `51F1950981B8E273BB94AF37093BB497A26CC3ACB5234F708C6709ED3CD5266C`.

The application serves this file locally; no CDN, npm runtime, API key, React or additional frontend build is needed.

Implementation guidance was read from https://github.com/CloudAI-X/threejs-skills (threejs-fundamentals, threejs-shaders, threejs-performance). Those skill files are installed in the local Codex skills folder; they are not browser runtime dependencies.
