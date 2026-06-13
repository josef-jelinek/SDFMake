# SDFMake Help

SDFMake scripts are a sequence of `let` assignments, `let` macro declarations, and one final render expression. The final expression is rendered directly; `object` is an ordinary assignment name with no special behavior.

```text
let size = 50
let center = [0, 0, mul(size, 0.5)]
let base = box(center, size)
let cut = cylinder([15, 15, 25], 8, 70)
subtract(base, cut)
```

Lines can contain comments with `#` or `//`. Number, list, and shape assignments are compile-time constants and must use `let name = expression`. A list literal uses `[a, b, c]` syntax. A 3D vector is a list with exactly 3 numeric items used where a primitive or operator expects a vector. List, function argument, and macro parameter lists can include one optional trailing comma before the closing `]` or `)`.

Units are millimeters. The build plane is `z = 0`, and the preview grid uses 10 mm cells. The final object is always cut by the visible volume box, so material below `z = 0` or outside the configured volume size is removed.

## Macros And Blocks

Macros are compile-time substitutions. Declare a macro with `let`, a name, parameters, `=`, and either a single expression or a block. Macro names cannot replace built-in primitive or operator names.

```text
let pair(a, b) = union(a, b)
let cut_with(base, cutter) = {
    let moved = move(cutter, [0, 0, 2])
    subtract(base, moved)
}

pair(box([0, 0, 10], 20), cut_with(box([0, 0, 10], 20), sphere([0, 0, 12], 4)))
```

Macro parameters shadow outer names inside the macro body. The arguments passed to the macro are still resolved where the macro is called, so `make(size)` can receive an outer `size` variable even when the macro parameter is also named `size`. Recursive macros are rejected.

Blocks use `{ ... }`, contain scoped `let` assignments, and end with a direct result expression. Names created inside a block are not visible outside it.

Macro declarations are only allowed at the top level. Macro arguments can be shapes, numbers, vectors, or other macro calls as long as the expanded value matches the primitive or operator argument where it is used.

## Lists And Loops

Lists are compile-time values. They can contain numbers, vectors, shapes, or other expressions. Use the spread operator `...` inside function calls to pass list items as separate arguments.

```text
let min_val = min(...[1, 2, 3, 4])
```

Use a range loop to create a list. Ranges are inclusive, and `step` is optional.

```text
let spheres = for i = 0 to 10 step 2 sphere([mul(i, 5), 0, 20], 2)
union(...spheres)
```

Use `for item in list` to transform a list. Inline loop bodies use the next expression directly. Braced bodies are scoped blocks and return their final expression.

```text
let squares = for val in for i = 0 to 3 i mul(val, val)
let moved = for item in spheres move(item, [0, 10, 0])
smooth_union(...moved, 4)
```

## Primitives

All primitive positions and dimensions are in millimeters. The z axis is vertical. Primitives take a vector where a position or size was previously split into `x, y, z` arguments.

- `sphere(center, radius)`
- `box(center, size)`. `size` can be a number for equal width, depth, and height, or a vector for per-axis dimensions.
- `rounded_box(center, size, edge_radius)` keeps the box dimensions and rounds each edge inward.
- `box_frame(center, size, thickness)` creates an open rectangular frame following the twelve box edges. `size` can be a number or vector.
- `chamfer_box(center, size, chamfer_size)` keeps the box dimensions and clips each edge inward with flat chamfers.
- `cylinder(center, radius, height)`, centered on the z axis
- `rounded_cylinder(center, radius, height, edge_radius)` keeps the cylinder radius and height and rounds the cap edges inward.
- `chamfer_cylinder(center, radius, height, chamfer_size)` keeps the cylinder radius and height and clips the cap edges inward with flat chamfers.
- `tri_prism(center, radius, height)`, `hex_prism(center, radius, height)`, and `octagon_prism(center, radius, height)` create centered z-axis prisms with regular polygon cross sections.
- `cone(base_center, height, base_radius, top_radius)`
- `rounded_cone(base_center, height, base_radius, top_radius, edge_radius)` keeps the cone side profile and rounds the base and top edges inward.
- `chamfer_cone(base_center, height, base_radius, top_radius, chamfer_size)` keeps the cone side profile and clips the base and top edges inward with flat chamfers.
- `pyramid(base_center, height, base_size)` creates a square pyramid with its base centered at `base_center` and apex at `base_center + [0, 0, height]`.
- `octahedron(center, size)` creates a centered regular octahedron.
- `torus(center, major_radius, minor_radius)`, centered around the z axis
- `capped_torus(center, major_radius, minor_radius, start_degrees, sweep_degrees)` creates a rounded tube along a partial torus arc in the xy plane. Positive sweep is counter-clockwise when viewed from +z.
- `capped_cylinder(start, end, radius)` or `capped_line(start, end, radius)` creates a rounded tube between two 3D points.
- `capped_cone(start, end, start_radius, end_radius)` creates a flat-capped tapered cone between two 3D points.

## Operators

- `union(a, b, ...)` combines two or more volumes.
- `intersect(a, b, ...)` keeps only the overlap of two or more volumes.
- `subtract(a, b, ...)` removes all following volumes from the first volume.
- `smooth_union(a, b, ..., radius)`, `smooth_intersect(a, b, ..., radius)`, and `smooth_subtract(a, b, ..., radius)` blend the operation with a mandatory final smooth radius.
- `chamfer_union(a, b, ..., radius)`, `chamfer_intersect(a, b, ..., radius)`, and `chamfer_subtract(a, b, ..., radius)` create flat 45-degree chamfers with a mandatory final chamfer size.
- `color(a, [r, g, b])` assigns a linear RGB color from `0` to `1` for the Solid and Solid photo previews. Mesh previews and STL export remain geometry-only.
- `min(a, b, ...)` returns the smallest value. When used with colored shapes, it keeps colors like `union`.
- `max(a, b, ...)` returns the largest value. When used with colored shapes, it keeps colors like `intersect`.
- `abs(a)` returns the absolute value.
- `add(a, b, ...)` adds values.
- `mul(a, b, ...)` multiplies values.
- `div(a, b)` divides `a` by `b`.
- `mod(a, b)` returns the modulo of `a` by `b`.
- `pow(a, b)` raises `a` to the power `b`.
- `move(a, offset)` moves a sub-shape by a vector.
- `scale(a, factor)` scales a sub-shape equally around the origin.
- `scale(a, scale_vector)` scales a sub-shape in all three axes around the origin.
- `rotate(a, axis, angle_degrees)` rotates a sub-shape around an axis vector through the origin. Facing in the axis direction, positive angles rotate clockwise.
- `round(a, radius)` rounds a surface outward.
- `shell(a, thickness)` turns a volume into a shell.

Example colored blend:

```text
let red = color(sphere([-8, 0, 20], 10), [1, 0.1, 0.05])
let blue = color(box([8, 0, 16], 16), [0.1, 0.25, 1])
smooth_union(red, blue, 4)
```

## Preview

The preview canvas uses WebGL2. Drag the canvas to rotate the camera and use the mouse wheel to zoom. Enable `Animate` to slowly orbit the camera around the object. Scripts are parsed and recompiled into the fragment shader after editing. Solid and Solid photo shaders compile lazily when their view is needed, and the previous selected shader stays active until its replacement is ready. The gray grid is the `z = 0` build plane with 10 mm cells, and the configured volume footprint is shown by a subtle darker square on the ground.

Use the Preview controls over the canvas to switch between Solid, Solid photo, and triangulated mesh views. Solid photo uses a heavier ray-marched lighting pass with soft shadows, ambient occlusion, specular reflections, and filtered ground shading. Shaded mesh and Triangle mesh use mesh ambient occlusion over the forward mesh render, with the mesh AO faded outside the central volume area so distant ground does not darken the horizon. If no mesh exists, mesh previews show a grayscale Solid preview and start triangulation when the preview is clicked.

## STL Export

STL export is a two-step process. First click `Triangulate` to sample the current SDF script on the CPU inside the visible triangulation volume and then run the selected reducer. The volume size control sets its width, depth, and height in millimeters. The height starts at the `z = 0` build plane, and the final object is clipped to this visible volume box. The Solid preview shows a faint wireframe of that visible volume, and Solid plus mesh previews darken its ground footprint slightly. Triangulation adds at least 1 mm of hidden padding on all sides before sampling, so surfaces touching the ground plane or volume faces are not sampled exactly on the boundary. The sampling grid uses the selected cell size directly, expands the hidden padded volume to whole cells, stays symmetric around `x = 0` and `y = 0`, and places cell boundaries on `z = 0`. Smaller cell sizes produce more triangles and take longer. The cell size defaults to 1 mm and is clamped to at least 0.1 mm. Subdivisions default to 2 and are clamped from 1 through 3. For Contour fit, the minimum feature size is the cell size divided by subdivisions. For Voxel and Voxel blend, subdivisions control how many subcell samples are taken on each axis before measuring cell occupancy. Marching tetrahedra does not use subdivisions, so the input is disabled for that mode. Marching tetrahedra clamps edge vertices away from tetrahedron corners using a reducer-derived weld threshold. Triangulation and selected reduction run in background workers and report progress in the preview overlay.

After triangulation finishes, `Export txt STL` downloads the current mesh as ASCII STL, and `Export bin STL` downloads the same mesh as binary STL.

The `Reducer` setting controls what happens after triangulation:

- `None` keeps the raw triangulated mesh.
- `Edge collapse` collapses edges from shortest to longest when merging the two edge vertices does not change the local surface planes or create additional bad edges.
- `Strong edge collapse` uses the same edge-collapse reducer, but allows up to 3 degrees of local plane deviation while keeping the same topology guards.

Choose a triangulator before triangulating:

- `Voxel` classifies full grid cells by sampled occupancy, keeps sharp cube faces, and adds 10 percent bridge geometry only where edge-touching or corner-touching cells are not already face-connected through neighboring voxels.
- `Voxel blend` assembles half-shifted junction tiles from the eight neighboring voxel states. Exterior and interior voxel transitions are blended with sloped facets, so exposed 90 degree and recessed 270 degree voxel junctions are replaced. Diagonal point contacts are left as separate chamfered corners instead of being bridged.
- `Marching tetrahedra` splits every grid cell into five tetrahedra with alternating 3D chessboard orientation and connects shared grid-edge crossings directly. This makes raw topology deterministic and avoids ambiguous contour-face cases. Edge vertices are clamped away from tetrahedron corners using a reducer-derived weld threshold, which avoids closure triangles smaller than the reducer can keep distinct.
- `Contour fit` samples the SDF on a grid. When the surface crosses a grid cell, it uses the edge crossings and surface normals to fit one representative vertex inside that cell, then connects neighboring fitted cell vertices across crossing grid edges. This preserves sharp edges and corners better than using the edge crossings directly.

## Appendix: Script Syntax BNF

This BNF describes the parsed script structure. Whitespace is ignored except where it separates tokens. Newlines are not statement separators. Comments start with `#` or `//` and continue to the end of the line.

```text
<script> ::= <top-level-prefix> <render-expression> <eof>

<top-level-prefix> ::= <top-level-item> <top-level-prefix>
                    | <empty>

<top-level-item> ::= <assignment>
                   | <macro-declaration>

<render-expression> ::= <expression>

<assignment> ::= "let" <identifier> "=" <expression>

<macro-declaration> ::= "let" <identifier> "(" <parameter-list-opt> ")" "=" <expression>

<parameter-list-opt> ::= <parameter-list>
                       | <empty>

<parameter-list> ::= <identifier> <parameter-list-tail>

<parameter-list-tail> ::= "," <parameter-list-tail-after-comma>
                        | <empty>

<parameter-list-tail-after-comma> ::= <identifier> <parameter-list-tail>
                                    | <empty>

<expression> ::= <block>
               | <for-range>
               | <for-each>
               | <list>
               | <function-call>
               | <identifier>
               | <number>

<block> ::= "{" <block-assignments> <expression> "}"

<block-assignments> ::= <block-assignment> <block-assignments>
                      | <empty>

<block-assignment> ::= "let" <identifier> "=" <expression>

<for-range> ::= "for" <identifier> "=" <expression> "to" <expression> <step-opt> <expression>

<step-opt> ::= "step" <expression>
             | <empty>

<for-each> ::= "for" <identifier> "in" <expression> <expression>

<list> ::= "[" <list-items-opt> "]"

<list-items-opt> ::= <list-items>
                   | <empty>

<list-items> ::= <expression> <list-items-tail>

<list-items-tail> ::= "," <list-items-tail-after-comma>
                    | <empty>

<list-items-tail-after-comma> ::= <expression> <list-items-tail>
                                | <empty>

<function-call> ::= <identifier> "(" <argument-list-opt> ")"

<argument-list-opt> ::= <argument-list>
                      | <empty>

<argument-list> ::= <argument> <argument-list-tail>

<argument-list-tail> ::= "," <argument-list-tail-after-comma>
                       | <empty>

<argument-list-tail-after-comma> ::= <argument> <argument-list-tail>
                                   | <empty>

<argument> ::= <expression>
             | "..." <expression>
```

The empty alternatives after commas represent the single optional trailing comma allowed before `)`, `]`, or a macro parameter list's closing `)`. The `...` spread form is only valid inside function call argument lists.

```text
<identifier> ::= <identifier-start> <identifier-parts>

<identifier-parts> ::= <identifier-part> <identifier-parts>
                     | <empty>

<identifier-start> ::= "A".."Z"
                     | "a".."z"
                     | "_"

<identifier-part> ::= <identifier-start>
                    | "0".."9"

<number> ::= <sign-opt> <number-body> <exponent-opt>

<sign-opt> ::= "+"
             | "-"
             | <empty>

<number-body> ::= <digits> "." <digits-opt>
                | "." <digits>
                | <digits>

<digits-opt> ::= <digits>
               | <empty>

<digits> ::= <digit> <digits-tail>

<digits-tail> ::= <digit> <digits-tail>
                | <empty>

<digit> ::= "0".."9"

<exponent-opt> ::= <exponent>
                 | <empty>

<exponent> ::= "e" <sign-opt> <digits>
             | "E" <sign-opt> <digits>
```

The words `let`, `for`, `to`, `in`, and `step` are scanned as identifiers and have special meaning only in the positions shown above. Built-in primitive and operator names are regular identifiers syntactically, but macro declarations cannot reuse them.
