# SDFMake

**Try it at https://josef-jelinek.github.io/SDFMake/**

SDFMake is a build-free WebGL2 web app for modelling solid objects with a small signed distance field script language. Scripts define primitives in millimeters, combine them with constructive operators, preview them by sphere tracing in a fragment shader, inspect a heavier Solid photo lighting preview, triangulate them in a worker, inspect the mesh in WebGL2, and export STL. The Solid and mesh previews share sky, exposure, ground grid, and volume footprint rendering so the configured modeling bounds stay visible.

The script language supports `let` number, list, vector, and shape assignments; `let` macro declarations; a final direct render expression; compile-time loops; scoped blocks; primitives such as boxes, frames, cylinders, cones, rounded and chamfered variants, prisms, pyramids, torus strokes, and capped tapered strokes; CSG operators; Solid preview colors; transforms; and primitive numeric operations. See `HELP.md` or the in-app Help button for the full syntax and control reference.

The primitive formulas are based on the signed distance function catalogue by Inigo Quilez:

https://iquilezles.org/articles/distfunctions/

## License

SDFMake is available under the MIT License. Parts of the SDF primitive and shader code are adapted from MIT-licensed work by Inigo Quilez; see `LICENSE` for the full project license and third-party notice.

## Run

Serve the project directory with any local static file server, then open the page in a WebGL2-capable browser.

```sh
python3 -m http.server 8000
```

Open:

```text
http://127.0.0.1:8000/
```

No build step or external JavaScript library is required.

## Project Layout

- `index.html` contains the app shell.
- `styles.css` contains layout styles.
- `theme.css` contains light and dark theme styles.
- `main.js` is the browser entry module.
- `js/` contains flat ES modules for parsing, compiling, meshing, and STL export.
- `glsl/` contains WebGL2 shader sources loaded at page start.
