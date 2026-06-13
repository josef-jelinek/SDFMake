const collapseNormalEpsilonDegrees = 0.05;
const strongCollapseNormalEpsilonDegrees = 3.0;
const collapseNormalCosEpsilon = Math.cos(collapseNormalEpsilonDegrees * Math.PI / 180.0);
const strongCollapseNormalCosEpsilon = Math.cos(strongCollapseNormalEpsilonDegrees * Math.PI / 180.0);
const positionVertexScale = 100000.0;
const reducerProgressStepCount = 10;

export function reduceMeshEdgeCollapse(sourcePositions, progressFunc) {
    return reduceMeshEdgeCollapseWithTolerance(sourcePositions, progressFunc, collapseNormalCosEpsilon);
}

export function reduceMeshStrongEdgeCollapse(sourcePositions, progressFunc) {
    return reduceMeshEdgeCollapseWithTolerance(sourcePositions, progressFunc, strongCollapseNormalCosEpsilon);
}

function reduceMeshEdgeCollapseWithTolerance(sourcePositions, progressFunc, normalCosEpsilon) {
    let positions = normalizePositions(sourcePositions);
    let triangleCount = Math.floor(positions.length / 9);
    let sourceBadEdgeCount = 0;
    let finalBadEdgeCount = 0;
    let sourceEdgeStats = null;
    let finalEdgeStats = null;
    let weldedPositions = null;
    let weldedEdgeStats = null;
    let mesh = null;
    let heap = null;
    let droppedEdges = new Map();
    let edge = createEdgeCollapsePoppedEdge();
    let workspace = createEdgeCollapseWorkspace();
    let collapse = null;
    let collapsedEdgeCount = 0;
    let finalPositions = null;
    let finalGuardRejected = false;
    let fallbackApplied = false;
    let weldTolerance = 0.0;

    if (typeof progressFunc !== "function") {
        progressFunc = null;
    }

    reportReduceProgress(progressFunc, "Preparing mesh collapse reducer", 0.0, 1, reducerProgressStepCount);

    if (triangleCount <= 0) {
        return createReduceResult(new Float32Array(0), 0, 0, false, 0, 0, false);
    }

    sourceEdgeStats = countMeshEdgeStats(positions, progressFunc, "Counting source mesh edges", 1, reducerProgressStepCount);
    sourceBadEdgeCount = sourceEdgeStats.badEdgeCount;

    weldTolerance = estimateWeldTolerance(positions, progressFunc, "Estimating reducer weld tolerance", 2, reducerProgressStepCount);
    mesh = createEdgeCollapseMesh(positions, weldTolerance, false, progressFunc, "Welding reducer vertices", 3, reducerProgressStepCount);
    weldedPositions = buildEdgeCollapseMeshPositions(mesh, progressFunc, "Checking welded reducer mesh", 4, reducerProgressStepCount);
    weldedEdgeStats = countMeshEdgeStats(weldedPositions, progressFunc, "Counting welded mesh edges", 5, reducerProgressStepCount);

    // Some valid meshes contain topology-critical vertices closer than the reducer weld tolerance.
    if (weldedEdgeStats.badEdgeCount > sourceBadEdgeCount) {
        mesh = createEdgeCollapseMesh(positions, 0.0, true, progressFunc, "Retrying coordinate vertex welding", 6, reducerProgressStepCount);
        weldedPositions = buildEdgeCollapseMeshPositions(mesh, progressFunc, "Checking minimally welded reducer mesh", 7, reducerProgressStepCount);
        weldedEdgeStats = countMeshEdgeStats(weldedPositions, progressFunc, "Counting minimally welded mesh edges", 8, reducerProgressStepCount);

        if (weldedEdgeStats.badEdgeCount > sourceBadEdgeCount) {
            reportReduceProgress(progressFunc, "Skipped reduction for weld-sensitive mesh", 1.0, reducerProgressStepCount, reducerProgressStepCount);
            return createReduceResult(positions, triangleCount, triangleCount, true, sourceBadEdgeCount, sourceBadEdgeCount, false);
        }
    }

    heap = createEdgeCollapseEdgeHeap(mesh.triangleActive.length * 3);
    workspace.normalCosEpsilon = normalCosEpsilon;
    pushAllEdgeCollapseEdges(mesh, heap, progressFunc, 9, reducerProgressStepCount);
    reportReduceProgress(progressFunc, "Collapsing edges", 0.0, 10, reducerProgressStepCount);

    while (heap.count > 0) {
        popEdgeCollapseEdge(heap, edge);

        if (!edgeCollapseEdgeIsCurrent(mesh, edge)) {
            continue;
        }

        if (edgeCollapseDroppedEdgeHas(droppedEdges, mesh, edge.a, edge.b)) {
            continue;
        }

        collapse = findEdgeCollapse(mesh, edge.a, edge.b, workspace);

        if (collapse.ok) {
            applyEdgeCollapse(mesh, collapse, heap, workspace);
            collapsedEdgeCount += 1;

            if (collapsedEdgeCount % 200 === 0) {
                reportReduceProgress(progressFunc, "Collapsing edges", collapsedEdgeCount / (collapsedEdgeCount + heap.count), 10, reducerProgressStepCount);
            }
        } else {
            addEdgeCollapseDroppedEdge(droppedEdges, mesh, edge.a, edge.b);
        }
    }

    finalPositions = buildEdgeCollapseMeshPositions(mesh);
    finalEdgeStats = countMeshEdgeStats(finalPositions);
    finalBadEdgeCount = finalEdgeStats.badEdgeCount;

    if (finalBadEdgeCount > sourceBadEdgeCount) {
        finalPositions = positions;
        finalBadEdgeCount = sourceBadEdgeCount;
        finalGuardRejected = true;
    }

    fallbackApplied = finalGuardRejected || Math.floor(finalPositions.length / 9) >= triangleCount;

    reportReduceProgress(progressFunc, "Reduced mesh", 1.0, 10, reducerProgressStepCount);

    return createReduceResult(
        finalPositions,
        triangleCount,
        Math.floor(finalPositions.length / 9),
        fallbackApplied,
        sourceBadEdgeCount,
        finalBadEdgeCount,
        finalGuardRejected
    );
}

function createEdgeCollapseMesh(positions, weldTolerance, coordinateOnly, progressFunc, progressLabel, progressStepIndex, progressStepCount) {
    let triangleCount = Math.floor(positions.length / 9);
    let maxVertexCount = triangleCount * 3;
    let vertexMap = new Map();
    let coordinateIds = createCoordinateIdStore();
    let mesh = createEdgeCollapseMeshStorage(triangleCount, maxVertexCount);
    let coordinateEdgeCounts = new Map();
    let triangleIndex = 0;
    let source = 0;
    let a = 0;
    let b = 0;
    let c = 0;

    mesh.vertexTriangleHead.fill(-1);
    mesh.vertexTriangleTail.fill(-1);

    for (triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
        source = triangleIndex * 9;
        if (coordinateOnly) {
            a = addCoordinateWeldedVertex(positions, source, vertexMap, coordinateIds, mesh);
            b = addCoordinateWeldedVertex(positions, source + 3, vertexMap, coordinateIds, mesh);
            c = addCoordinateWeldedVertex(positions, source + 6, vertexMap, coordinateIds, mesh);
        } else {
            a = addWeldedVertex(positions, source, weldTolerance, vertexMap, coordinateIds, mesh);
            b = addWeldedVertex(positions, source + 3, weldTolerance, vertexMap, coordinateIds, mesh);
            c = addWeldedVertex(positions, source + 6, weldTolerance, vertexMap, coordinateIds, mesh);
        }

        mesh.triangleA[triangleIndex] = a;
        mesh.triangleB[triangleIndex] = b;
        mesh.triangleC[triangleIndex] = c;
        mesh.triangleActive[triangleIndex] = 1;
        addEdgeCollapseCoordinateEdgeCount(coordinateEdgeCounts, mesh.vertexCoordinateKey, a, b, 1);
        addEdgeCollapseCoordinateEdgeCount(coordinateEdgeCounts, mesh.vertexCoordinateKey, b, c, 1);
        addEdgeCollapseCoordinateEdgeCount(coordinateEdgeCounts, mesh.vertexCoordinateKey, c, a, 1);
        addEdgeCollapseVertexTriangle(mesh, a, triangleIndex);
        addEdgeCollapseVertexTriangle(mesh, b, triangleIndex);
        addEdgeCollapseVertexTriangle(mesh, c, triangleIndex);

        if (triangleIndex % 4096 === 0) {
            reportReduceProgress(progressFunc, progressLabel, triangleIndex / Math.max(triangleCount, 1), progressStepIndex, progressStepCount);
        }
    }

    reportReduceProgress(progressFunc, progressLabel, 1.0, progressStepIndex, progressStepCount);
    mesh.coordinateEdgeCounts = coordinateEdgeCounts;

    return mesh;
}

function createEdgeCollapseMeshStorage(triangleCount, maxVertexCount) {
    return {
        vertexX: new Float64Array(maxVertexCount),
        vertexY: new Float64Array(maxVertexCount),
        vertexZ: new Float64Array(maxVertexCount),
        vertexCoordinateKey: new Int32Array(maxVertexCount),
        vertexActive: new Uint8Array(maxVertexCount),
        vertexVersion: new Int32Array(maxVertexCount),
        vertexTriangleHead: new Int32Array(maxVertexCount),
        vertexTriangleTail: new Int32Array(maxVertexCount),
        vertexTriangleCount: new Int32Array(maxVertexCount),
        vertexTriangleRefTriangle: new Int32Array(maxVertexCount),
        vertexTriangleRefNext: new Int32Array(maxVertexCount),
        vertexTriangleRefCount: 0,
        vertexCount: 0,
        triangleA: new Int32Array(triangleCount),
        triangleB: new Int32Array(triangleCount),
        triangleC: new Int32Array(triangleCount),
        triangleActive: new Uint8Array(triangleCount),
        activeTriangleCount: triangleCount
    };
}

function addEdgeCollapseVertexTriangle(mesh, vertex, triangleIndex) {
    let ref = 0;

    ensureEdgeCollapseVertexTriangleCapacity(mesh, mesh.vertexTriangleRefCount + 1);
    ref = mesh.vertexTriangleRefCount;
    mesh.vertexTriangleRefCount += 1;
    mesh.vertexTriangleRefTriangle[ref] = triangleIndex;
    mesh.vertexTriangleRefNext[ref] = -1;

    if (mesh.vertexTriangleHead[vertex] < 0) {
        mesh.vertexTriangleHead[vertex] = ref;
    } else {
        mesh.vertexTriangleRefNext[mesh.vertexTriangleTail[vertex]] = ref;
    }

    mesh.vertexTriangleTail[vertex] = ref;
    mesh.vertexTriangleCount[vertex] += 1;
}

function ensureEdgeCollapseVertexTriangleCapacity(mesh, neededCapacity) {
    let newCapacity = 0;

    if (neededCapacity <= mesh.vertexTriangleRefTriangle.length) {
        return;
    }

    newCapacity = Math.max(neededCapacity, mesh.vertexTriangleRefTriangle.length * 2);
    mesh.vertexTriangleRefTriangle = growInt32Array(mesh.vertexTriangleRefTriangle, newCapacity);
    mesh.vertexTriangleRefNext = growInt32Array(mesh.vertexTriangleRefNext, newCapacity);
}

function createEdgeCollapseEdgeHeap(capacity) {
    let cleanCapacity = Math.max(Math.floor(Number(capacity)), 16);

    return {
        a: new Int32Array(cleanCapacity),
        b: new Int32Array(cleanCapacity),
        lengthSquared: new Float64Array(cleanCapacity),
        versionA: new Int32Array(cleanCapacity),
        versionB: new Int32Array(cleanCapacity),
        count: 0
    };
}

function pushAllEdgeCollapseEdges(mesh, heap, progressFunc, progressStepIndex, progressStepCount) {
    let edgeKeys = new Set();
    let triangleIndex = 0;
    let triangleCount = mesh.triangleActive.length;

    for (triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
        if (mesh.triangleActive[triangleIndex]) {
            appendUniqueEdgeCollapseTriangleEdges(mesh, heap, edgeKeys, triangleIndex);
        }

        if (triangleIndex % 4096 === 0) {
            reportReduceProgressRange(progressFunc, "Preparing collapse queue", triangleIndex / Math.max(triangleCount, 1), 0.0, 0.80, progressStepIndex, progressStepCount);
        }
    }

    heapifyEdgeCollapseHeap(heap);
    reportReduceProgress(progressFunc, "Preparing collapse queue", 1.0, progressStepIndex, progressStepCount);
}

function appendUniqueEdgeCollapseTriangleEdges(mesh, heap, edgeKeys, triangleIndex) {
    appendUniqueEdgeCollapseEdge(mesh, heap, edgeKeys, mesh.triangleA[triangleIndex], mesh.triangleB[triangleIndex]);
    appendUniqueEdgeCollapseEdge(mesh, heap, edgeKeys, mesh.triangleB[triangleIndex], mesh.triangleC[triangleIndex]);
    appendUniqueEdgeCollapseEdge(mesh, heap, edgeKeys, mesh.triangleC[triangleIndex], mesh.triangleA[triangleIndex]);
}

function appendUniqueEdgeCollapseEdge(mesh, heap, edgeKeys, a, b) {
    let key = edgeKey(a, b);

    if (edgeKeys.has(key)) {
        return;
    }

    edgeKeys.add(key);
    appendEdgeCollapseEdge(mesh, heap, a, b);
}

function appendEdgeCollapseEdge(mesh, heap, a, b) {
    let index = 0;

    if (a === b || !mesh.vertexActive[a] || !mesh.vertexActive[b]) {
        return;
    }

    ensureEdgeCollapseHeapCapacity(heap, heap.count + 1);
    index = heap.count;
    heap.a[index] = a;
    heap.b[index] = b;
    heap.lengthSquared[index] = edgeCollapseEdgeLengthSquared(mesh, a, b);
    heap.versionA[index] = mesh.vertexVersion[a];
    heap.versionB[index] = mesh.vertexVersion[b];
    heap.count += 1;
}

function heapifyEdgeCollapseHeap(heap) {
    let index = Math.floor(heap.count / 2) - 1;

    while (index >= 0) {
        siftEdgeCollapseHeapDown(heap, index);
        index -= 1;
    }
}

function pushUniqueEdgeCollapseTriangleEdges(mesh, heap, edgeKeys, triangleIndex) {
    pushUniqueEdgeCollapseEdge(mesh, heap, edgeKeys, mesh.triangleA[triangleIndex], mesh.triangleB[triangleIndex]);
    pushUniqueEdgeCollapseEdge(mesh, heap, edgeKeys, mesh.triangleB[triangleIndex], mesh.triangleC[triangleIndex]);
    pushUniqueEdgeCollapseEdge(mesh, heap, edgeKeys, mesh.triangleC[triangleIndex], mesh.triangleA[triangleIndex]);
}

function pushUniqueEdgeCollapseEdge(mesh, heap, edgeKeys, a, b) {
    let key = edgeKey(a, b);

    if (edgeKeys.has(key)) {
        return;
    }

    edgeKeys.add(key);
    pushEdgeCollapseEdge(mesh, heap, a, b);
}

function pushEdgeCollapseEdge(mesh, heap, a, b) {
    let index = 0;

    if (a === b || !mesh.vertexActive[a] || !mesh.vertexActive[b]) {
        return;
    }

    ensureEdgeCollapseHeapCapacity(heap, heap.count + 1);
    index = heap.count;
    heap.a[index] = a;
    heap.b[index] = b;
    heap.lengthSquared[index] = edgeCollapseEdgeLengthSquared(mesh, a, b);
    heap.versionA[index] = mesh.vertexVersion[a];
    heap.versionB[index] = mesh.vertexVersion[b];
    heap.count += 1;
    siftEdgeCollapseHeapUp(heap, index);
}

function ensureEdgeCollapseHeapCapacity(heap, neededCapacity) {
    let newCapacity = 0;

    if (neededCapacity <= heap.a.length) {
        return;
    }

    newCapacity = Math.max(neededCapacity, heap.a.length * 2);
    heap.a = growInt32Array(heap.a, newCapacity);
    heap.b = growInt32Array(heap.b, newCapacity);
    heap.lengthSquared = growFloat64Array(heap.lengthSquared, newCapacity);
    heap.versionA = growInt32Array(heap.versionA, newCapacity);
    heap.versionB = growInt32Array(heap.versionB, newCapacity);
}

function growInt32Array(source, capacity) {
    let target = new Int32Array(capacity);

    target.set(source);
    return target;
}

function growFloat64Array(source, capacity) {
    let target = new Float64Array(capacity);

    target.set(source);
    return target;
}

function createEdgeCollapsePoppedEdge() {
    return {
        a: 0,
        b: 0,
        lengthSquared: 0.0,
        versionA: 0,
        versionB: 0
    };
}

function createEdgeCollapseWorkspace() {
    return {
        edgeTriangles: [],
        sourceTriangles: [],
        sourceNeighbors: [],
        targetNeighbors: [],
        edgeDeltas: new Map(),
        edgeDeltaKeys: [],
        removedTriangles: createEdgeCollapseIndexMarker(),
        opposite: [],
        triangleSeen: createEdgeCollapseIndexMarker(),
        changedVertices: [],
        edgeKeys: new Set(),
        edgesAroundVertex: [],
        neighborTriangles: [],
        originalMeasure: createEdgeCollapseTriangleMeasure(),
        movedMeasure: createEdgeCollapseTriangleMeasure(),
        normalCosEpsilon: collapseNormalCosEpsilon,
        failedCollapse: {
            ok: false
        },
        collapse: {
            ok: false,
            source: 0,
            target: 0,
            sourceTriangles: null,
            removedTriangles: null
        }
    };
}

function createEdgeCollapseTriangleMeasure() {
    return {
        ok: false,
        nx: 0.0,
        ny: 0.0,
        nz: 1.0,
        area: 0.0
    };
}

function createEdgeCollapseIndexMarker() {
    return {
        marks: new Uint32Array(0),
        token: 1
    };
}

function beginEdgeCollapseIndexMarker(marker, capacity) {
    if (capacity > marker.marks.length) {
        marker.marks = new Uint32Array(capacity);
    }

    marker.token += 1;

    if (marker.token === 0 || marker.token > 4000000000) {
        marker.marks.fill(0);
        marker.token = 1;
    }
}

function markEdgeCollapseIndex(marker, index) {
    marker.marks[index] = marker.token;
}

function edgeCollapseIndexMarkerHas(marker, index) {
    return marker.marks[index] === marker.token;
}

function popEdgeCollapseEdge(heap, result) {
    let last = heap.count - 1;

    result.a = heap.a[0];
    result.b = heap.b[0];
    result.lengthSquared = heap.lengthSquared[0];
    result.versionA = heap.versionA[0];
    result.versionB = heap.versionB[0];

    heap.count -= 1;

    if (heap.count > 0) {
        heap.a[0] = heap.a[last];
        heap.b[0] = heap.b[last];
        heap.lengthSquared[0] = heap.lengthSquared[last];
        heap.versionA[0] = heap.versionA[last];
        heap.versionB[0] = heap.versionB[last];
        siftEdgeCollapseHeapDown(heap, 0);
    }
}

function siftEdgeCollapseHeapUp(heap, index) {
    let current = index;
    let parent = 0;

    while (current > 0) {
        parent = Math.floor((current - 1) / 2);

        if (heap.lengthSquared[parent] <= heap.lengthSquared[current]) {
            return;
        }

        swapEdgeCollapseHeapItems(heap, parent, current);
        current = parent;
    }
}

function siftEdgeCollapseHeapDown(heap, index) {
    let current = index;
    let child = 0;
    let left = 0;
    let right = 0;

    while (true) {
        child = current;
        left = current * 2 + 1;
        right = left + 1;

        if (left < heap.count && heap.lengthSquared[left] < heap.lengthSquared[child]) {
            child = left;
        }

        if (right < heap.count && heap.lengthSquared[right] < heap.lengthSquared[child]) {
            child = right;
        }

        if (child === current) {
            return;
        }

        swapEdgeCollapseHeapItems(heap, current, child);
        current = child;
    }
}

function swapEdgeCollapseHeapItems(heap, first, second) {
    let swap = 0;

    swap = heap.a[first];
    heap.a[first] = heap.a[second];
    heap.a[second] = swap;
    swap = heap.b[first];
    heap.b[first] = heap.b[second];
    heap.b[second] = swap;
    swap = heap.lengthSquared[first];
    heap.lengthSquared[first] = heap.lengthSquared[second];
    heap.lengthSquared[second] = swap;
    swap = heap.versionA[first];
    heap.versionA[first] = heap.versionA[second];
    heap.versionA[second] = swap;
    swap = heap.versionB[first];
    heap.versionB[first] = heap.versionB[second];
    heap.versionB[second] = swap;
}

function edgeCollapseEdgeLengthSquared(mesh, a, b) {
    let dx = mesh.vertexX[b] - mesh.vertexX[a];
    let dy = mesh.vertexY[b] - mesh.vertexY[a];
    let dz = mesh.vertexZ[b] - mesh.vertexZ[a];

    return dx * dx + dy * dy + dz * dz;
}

function edgeCollapseEdgeIsCurrent(mesh, edge) {
    return mesh.vertexActive[edge.a]
        && mesh.vertexActive[edge.b]
        && mesh.vertexVersion[edge.a] === edge.versionA
        && mesh.vertexVersion[edge.b] === edge.versionB
        && edgeCollapseEdgeHasTriangle(mesh, edge.a, edge.b);
}

function edgeCollapseDroppedEdgeHas(droppedEdges, mesh, a, b) {
    let edge = edgeKey(a, b);
    let version = edgeCollapseDroppedEdgeVersionKey(mesh, a, b);
    let versions = droppedEdges.get(edge);

    return versions !== undefined && versions.has(version);
}

function addEdgeCollapseDroppedEdge(droppedEdges, mesh, a, b) {
    let edge = edgeKey(a, b);
    let version = edgeCollapseDroppedEdgeVersionKey(mesh, a, b);
    let versions = droppedEdges.get(edge);

    if (!versions) {
        versions = new Set();
        droppedEdges.set(edge, versions);
    }

    versions.add(version);
}

function edgeCollapseDroppedEdgeVersionKey(mesh, a, b) {
    let first = a;
    let second = b;
    let swap = 0;
    let versionBase = mesh.triangleActive.length + 1;

    if (b < a) {
        swap = first;
        first = second;
        second = swap;
    }

    return mesh.vertexVersion[first] * versionBase + mesh.vertexVersion[second];
}

function findEdgeCollapse(mesh, a, b, workspace) {
    let edgeTriangles = fillEdgeCollapseEdgeTriangles(mesh, a, b, workspace.edgeTriangles, workspace.triangleSeen);
    let collapse = null;

    if (edgeTriangles.length !== 2) {
        return workspace.failedCollapse;
    }

    collapse = evaluateEdgeCollapse(mesh, a, b, edgeTriangles, workspace);

    if (collapse.ok) {
        return collapse;
    }

    return evaluateEdgeCollapse(mesh, b, a, edgeTriangles, workspace);
}

function evaluateEdgeCollapse(mesh, source, target, edgeTriangles, workspace) {
    let sourceTriangles = fillEdgeCollapseVertexTriangles(mesh, source, workspace.sourceTriangles, workspace.triangleSeen);
    let removedTriangles = workspace.removedTriangles;
    let beforeArea = 0.0;
    let afterArea = 0.0;
    let index = 0;
    let triangleIndex = 0;
    let original = workspace.originalMeasure;
    let moved = workspace.movedMeasure;
    let areaTolerance = 0.0;
    let collapse = workspace.collapse;

    beginEdgeCollapseIndexMarker(removedTriangles, mesh.triangleActive.length);

    if (!edgeCollapsePassesLinkCondition(mesh, source, target, edgeTriangles, workspace)) {
        return workspace.failedCollapse;
    }

    for (index = 0; index < sourceTriangles.length; index += 1) {
        triangleIndex = sourceTriangles[index];
        measureEdgeCollapseTriangle(mesh, mesh.triangleA[triangleIndex], mesh.triangleB[triangleIndex], mesh.triangleC[triangleIndex], original);
        beforeArea += original.area;

        if (triangleContainsVertices(mesh, triangleIndex, source, target)) {
            markEdgeCollapseIndex(removedTriangles, triangleIndex);
            continue;
        }

        measureMovedEdgeCollapseTriangle(mesh, triangleIndex, source, target, moved);

        if (!moved.ok || moved.area <= 0.0) {
            if (movedEdgeCollapseTriangleIsColinear(mesh, triangleIndex, source, target)) {
                markEdgeCollapseIndex(removedTriangles, triangleIndex);
                continue;
            }

            return workspace.failedCollapse;
        }

        if (!edgeCollapseTrianglePlanesMatch(original, moved, workspace.normalCosEpsilon)) {
            return workspace.failedCollapse;
        }

        afterArea += moved.area;
    }

    areaTolerance = Math.max(0.0000001, beforeArea * Math.max(0.000001, 1.0 - workspace.normalCosEpsilon));

    if (Math.abs(beforeArea - afterArea) > areaTolerance) {
        return workspace.failedCollapse;
    }

    if (!edgeCollapsePreservesCoordinateEdges(mesh, source, target, sourceTriangles, removedTriangles, workspace)) {
        return workspace.failedCollapse;
    }

    collapse.ok = true;
    collapse.source = source;
    collapse.target = target;
    collapse.sourceTriangles = sourceTriangles;
    collapse.removedTriangles = removedTriangles;
    return collapse;
}

// Rejects collapses that would leave overused/open coordinate edges in the affected one-ring.
function edgeCollapsePreservesCoordinateEdges(mesh, source, target, sourceTriangles, removedTriangles, workspace) {
    let edgeDeltas = workspace.edgeDeltas;
    let edgeDeltaKeys = workspace.edgeDeltaKeys;
    let index = 0;
    let triangleIndex = 0;
    let a = 0;
    let b = 0;
    let c = 0;
    let key = 0;
    let delta = 0;
    let currentCount = 0;
    let finalCount = 0;

    edgeDeltas.clear();
    edgeDeltaKeys.length = 0;

    for (index = 0; index < sourceTriangles.length; index += 1) {
        triangleIndex = sourceTriangles[index];

        if (!mesh.triangleActive[triangleIndex]) {
            continue;
        }

        addEdgeCollapseTriangleCoordinateDeltas(mesh, edgeDeltas, edgeDeltaKeys, triangleIndex, -1);

        if (edgeCollapseIndexMarkerHas(removedTriangles, triangleIndex)) {
            continue;
        }

        a = movedEdgeCollapseVertex(mesh.triangleA[triangleIndex], source, target);
        b = movedEdgeCollapseVertex(mesh.triangleB[triangleIndex], source, target);
        c = movedEdgeCollapseVertex(mesh.triangleC[triangleIndex], source, target);

        if (a === b || b === c || c === a) {
            return false;
        }

        addEdgeCollapseCoordinateEdgeDelta(edgeDeltas, edgeDeltaKeys, mesh, a, b, 1);
        addEdgeCollapseCoordinateEdgeDelta(edgeDeltas, edgeDeltaKeys, mesh, b, c, 1);
        addEdgeCollapseCoordinateEdgeDelta(edgeDeltas, edgeDeltaKeys, mesh, c, a, 1);
    }

    for (index = 0; index < edgeDeltaKeys.length; index += 1) {
        key = edgeDeltaKeys[index];
        delta = edgeDeltas.get(key);

        if (!delta) {
            continue;
        }

        currentCount = currentEdgeCollapseCoordinateEdgeCount(mesh, key);
        finalCount = currentCount + delta;

        if (finalCount === 0) {
            continue;
        }

        if (currentCount === 1 && finalCount === 1) {
            continue;
        }

        if (finalCount !== 2) {
            return false;
        }
    }

    return true;
}

function addEdgeCollapseTriangleCoordinateDeltas(mesh, edgeDeltas, edgeDeltaKeys, triangleIndex, delta) {
    addEdgeCollapseCoordinateEdgeDelta(edgeDeltas, edgeDeltaKeys, mesh, mesh.triangleA[triangleIndex], mesh.triangleB[triangleIndex], delta);
    addEdgeCollapseCoordinateEdgeDelta(edgeDeltas, edgeDeltaKeys, mesh, mesh.triangleB[triangleIndex], mesh.triangleC[triangleIndex], delta);
    addEdgeCollapseCoordinateEdgeDelta(edgeDeltas, edgeDeltaKeys, mesh, mesh.triangleC[triangleIndex], mesh.triangleA[triangleIndex], delta);
}

function addEdgeCollapseCoordinateEdgeDelta(edgeDeltas, edgeDeltaKeys, mesh, a, b, delta) {
    let key = edgeCollapseCoordinateEdgeKey(mesh, a, b);
    let value = 0;

    value = edgeDeltas.get(key);

    if (!value) {
        value = 0;
    }

    if (!edgeDeltas.has(key)) {
        edgeDeltaKeys.push(key);
    }

    value += delta;

    edgeDeltas.set(key, value);
}

function currentEdgeCollapseCoordinateEdgeCount(mesh, key) {
    let count = mesh.coordinateEdgeCounts.get(key);

    if (!count) {
        return 0;
    }

    return count;
}

function edgeCollapsePassesLinkCondition(mesh, source, target, edgeTriangles, workspace) {
    let sourceNeighbors = fillEdgeCollapseNeighborSet(mesh, source, target, workspace.sourceNeighbors, workspace.neighborTriangles, workspace.triangleSeen);
    let targetNeighbors = fillEdgeCollapseNeighborSet(mesh, target, source, workspace.targetNeighbors, workspace.neighborTriangles, workspace.triangleSeen);
    let opposite = workspace.opposite;
    let intersectionCount = 0;
    let value = 0;
    let index = 0;
    let vertex = 0;

    opposite.length = 0;

    for (index = 0; index < edgeTriangles.length; index += 1) {
        vertex = oppositeEdgeCollapseTriangleVertex(mesh, edgeTriangles[index], source, target);

        if (vertex < 0) {
            return false;
        }

        pushUniqueEdgeCollapseArrayValue(opposite, vertex);
    }

    if (opposite.length !== 2) {
        return false;
    }

    for (index = 0; index < sourceNeighbors.length; index += 1) {
        value = sourceNeighbors[index];

        if (edgeCollapseArrayHasValue(targetNeighbors, value)) {
            if (!edgeCollapseArrayHasValue(opposite, value)) {
                return false;
            }

            intersectionCount += 1;
        }
    }

    return intersectionCount === 2;
}

function fillEdgeCollapseNeighborSet(mesh, vertex, excludedVertex, neighbors, triangles, seen) {
    fillEdgeCollapseVertexTriangles(mesh, vertex, triangles, seen);
    let index = 0;
    let triangleIndex = 0;

    neighbors.length = 0;

    for (index = 0; index < triangles.length; index += 1) {
        triangleIndex = triangles[index];
        addEdgeCollapseTriangleNeighbors(mesh, neighbors, triangleIndex, vertex, excludedVertex);
    }

    return neighbors;
}

function addEdgeCollapseTriangleNeighbors(mesh, neighbors, triangleIndex, vertex, excludedVertex) {
    addEdgeCollapseNeighbor(neighbors, mesh.triangleA[triangleIndex], vertex, excludedVertex);
    addEdgeCollapseNeighbor(neighbors, mesh.triangleB[triangleIndex], vertex, excludedVertex);
    addEdgeCollapseNeighbor(neighbors, mesh.triangleC[triangleIndex], vertex, excludedVertex);
}

function addEdgeCollapseNeighbor(neighbors, candidate, vertex, excludedVertex) {
    if (candidate === vertex || candidate === excludedVertex) {
        return;
    }

    if (!edgeCollapseArrayHasValue(neighbors, candidate)) {
        neighbors.push(candidate);
    }
}

function oppositeEdgeCollapseTriangleVertex(mesh, triangleIndex, a, b) {
    if (mesh.triangleA[triangleIndex] !== a && mesh.triangleA[triangleIndex] !== b) {
        return mesh.triangleA[triangleIndex];
    }

    if (mesh.triangleB[triangleIndex] !== a && mesh.triangleB[triangleIndex] !== b) {
        return mesh.triangleB[triangleIndex];
    }

    if (mesh.triangleC[triangleIndex] !== a && mesh.triangleC[triangleIndex] !== b) {
        return mesh.triangleC[triangleIndex];
    }

    return -1;
}

function measureMovedEdgeCollapseTriangle(mesh, triangleIndex, source, target, result) {
    let a = movedEdgeCollapseVertex(mesh.triangleA[triangleIndex], source, target);
    let b = movedEdgeCollapseVertex(mesh.triangleB[triangleIndex], source, target);
    let c = movedEdgeCollapseVertex(mesh.triangleC[triangleIndex], source, target);

    if (a === b || b === c || c === a) {
        result.ok = false;
        result.area = 0.0;
        return result;
    }

    measureEdgeCollapseTriangle(mesh, a, b, c, result);
    result.ok = true;

    return result;
}

function movedEdgeCollapseTriangleIsColinear(mesh, triangleIndex, source, target) {
    let first = -1;
    let second = -1;

    if (!collectOppositeEdgeCollapseSide(mesh, triangleIndex, source, target)) {
        return false;
    }

    first = edgeCollapseOppositeSideFirst(mesh, triangleIndex, source);
    second = edgeCollapseOppositeSideSecond(mesh, triangleIndex, source, first);

    return first >= 0
        && second >= 0
        && edgeCollapseVertexLiesOnSegment(mesh, target, first, second);
}

function collectOppositeEdgeCollapseSide(mesh, triangleIndex, source, target) {
    return !triangleContainsVertex(mesh, triangleIndex, target)
        && triangleContainsVertex(mesh, triangleIndex, source);
}

function edgeCollapseOppositeSideFirst(mesh, triangleIndex, source) {
    if (mesh.triangleA[triangleIndex] !== source) {
        return mesh.triangleA[triangleIndex];
    }

    if (mesh.triangleB[triangleIndex] !== source) {
        return mesh.triangleB[triangleIndex];
    }

    return mesh.triangleC[triangleIndex];
}

function edgeCollapseOppositeSideSecond(mesh, triangleIndex, source, first) {
    if (mesh.triangleA[triangleIndex] !== source && mesh.triangleA[triangleIndex] !== first) {
        return mesh.triangleA[triangleIndex];
    }

    if (mesh.triangleB[triangleIndex] !== source && mesh.triangleB[triangleIndex] !== first) {
        return mesh.triangleB[triangleIndex];
    }

    if (mesh.triangleC[triangleIndex] !== source && mesh.triangleC[triangleIndex] !== first) {
        return mesh.triangleC[triangleIndex];
    }

    return -1;
}

function edgeCollapseVertexLiesOnSegment(mesh, vertex, first, second) {
    let ax = mesh.vertexX[first];
    let ay = mesh.vertexY[first];
    let az = mesh.vertexZ[first];
    let bx = mesh.vertexX[second];
    let by = mesh.vertexY[second];
    let bz = mesh.vertexZ[second];
    let px = mesh.vertexX[vertex];
    let py = mesh.vertexY[vertex];
    let pz = mesh.vertexZ[vertex];
    let abx = bx - ax;
    let aby = by - ay;
    let abz = bz - az;
    let apx = px - ax;
    let apy = py - ay;
    let apz = pz - az;
    let crossX = aby * apz - abz * apy;
    let crossY = abz * apx - abx * apz;
    let crossZ = abx * apy - aby * apx;
    let segmentLengthSquared = abx * abx + aby * aby + abz * abz;
    let crossLengthSquared = crossX * crossX + crossY * crossY + crossZ * crossZ;
    let dot = abx * apx + aby * apy + abz * apz;
    let tolerance = 0.0;

    if (segmentLengthSquared <= 0.0) {
        return false;
    }

    tolerance = Math.max(0.000000000001, segmentLengthSquared * segmentLengthSquared * 0.000000000001);

    return crossLengthSquared <= tolerance
        && dot >= -0.000000001
        && dot <= segmentLengthSquared + 0.000000001;
}

function movedEdgeCollapseVertex(vertex, source, target) {
    if (vertex === source) {
        return target;
    }

    return vertex;
}

function measureEdgeCollapseTriangle(mesh, a, b, c, result) {
    let ux = mesh.vertexX[b] - mesh.vertexX[a];
    let uy = mesh.vertexY[b] - mesh.vertexY[a];
    let uz = mesh.vertexZ[b] - mesh.vertexZ[a];
    let vx = mesh.vertexX[c] - mesh.vertexX[a];
    let vy = mesh.vertexY[c] - mesh.vertexY[a];
    let vz = mesh.vertexZ[c] - mesh.vertexZ[a];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    let length = Math.hypot(nx, ny, nz);

    if (length <= 0.0) {
        result.ok = false;
        result.nx = 0.0;
        result.ny = 0.0;
        result.nz = 1.0;
        result.area = 0.0;
        return result;
    }

    result.ok = true;
    result.nx = nx / length;
    result.ny = ny / length;
    result.nz = nz / length;
    result.area = length * 0.5;
    return result;
}

function edgeCollapseTrianglePlanesMatch(original, moved, normalCosEpsilon) {
    let dot = original.nx * moved.nx + original.ny * moved.ny + original.nz * moved.nz;

    return dot >= normalCosEpsilon;
}

function applyEdgeCollapse(mesh, collapse, heap, workspace) {
    let source = collapse.source;
    let target = collapse.target;
    let changedVertices = workspace.changedVertices;
    let index = 0;
    let triangleIndex = 0;

    changedVertices.length = 0;

    for (index = 0; index < collapse.sourceTriangles.length; index += 1) {
        triangleIndex = collapse.sourceTriangles[index];

        if (!mesh.triangleActive[triangleIndex]) {
            continue;
        }

        addEdgeCollapseTriangleVertices(mesh, changedVertices, triangleIndex);
        addEdgeCollapseTriangleCoordinateEdges(mesh, triangleIndex, -1);

        if (edgeCollapseIndexMarkerHas(collapse.removedTriangles, triangleIndex)) {
            mesh.triangleActive[triangleIndex] = false;
            mesh.activeTriangleCount -= 1;
            continue;
        }

        replaceEdgeCollapseTriangleVertex(mesh, triangleIndex, source, target);
        addEdgeCollapseVertexTriangle(mesh, target, triangleIndex);
        addEdgeCollapseTriangleVertices(mesh, changedVertices, triangleIndex);
        addEdgeCollapseTriangleCoordinateEdges(mesh, triangleIndex, 1);
    }

    mesh.vertexActive[source] = false;
    pushUniqueEdgeCollapseArrayValue(changedVertices, source);
    pushUniqueEdgeCollapseArrayValue(changedVertices, target);
    bumpEdgeCollapseVertexVersions(mesh, changedVertices);
    pushEdgeCollapseEdgesAroundVertex(mesh, heap, target, workspace);
}

function addEdgeCollapseTriangleVertices(mesh, values, triangleIndex) {
    pushUniqueEdgeCollapseArrayValue(values, mesh.triangleA[triangleIndex]);
    pushUniqueEdgeCollapseArrayValue(values, mesh.triangleB[triangleIndex]);
    pushUniqueEdgeCollapseArrayValue(values, mesh.triangleC[triangleIndex]);
}

function replaceEdgeCollapseTriangleVertex(mesh, triangleIndex, source, target) {
    if (mesh.triangleA[triangleIndex] === source) {
        mesh.triangleA[triangleIndex] = target;
    }

    if (mesh.triangleB[triangleIndex] === source) {
        mesh.triangleB[triangleIndex] = target;
    }

    if (mesh.triangleC[triangleIndex] === source) {
        mesh.triangleC[triangleIndex] = target;
    }
}

function addEdgeCollapseTriangleCoordinateEdges(mesh, triangleIndex, delta) {
    addEdgeCollapseCoordinateEdgeCount(mesh.coordinateEdgeCounts, mesh.vertexCoordinateKey, mesh.triangleA[triangleIndex], mesh.triangleB[triangleIndex], delta);
    addEdgeCollapseCoordinateEdgeCount(mesh.coordinateEdgeCounts, mesh.vertexCoordinateKey, mesh.triangleB[triangleIndex], mesh.triangleC[triangleIndex], delta);
    addEdgeCollapseCoordinateEdgeCount(mesh.coordinateEdgeCounts, mesh.vertexCoordinateKey, mesh.triangleC[triangleIndex], mesh.triangleA[triangleIndex], delta);
}

function addEdgeCollapseCoordinateEdgeCount(edgeCounts, vertexCoordinateKey, a, b, delta) {
    let key = edgeKey(vertexCoordinateKey[a], vertexCoordinateKey[b]);
    let count = 0;

    count = edgeCounts.get(key);

    if (!count) {
        count = 0;
    }

    count += delta;

    if (count <= 0) {
        edgeCounts.delete(key);
        return;
    }

    edgeCounts.set(key, count);
}

function edgeCollapseCoordinateEdgeKey(mesh, a, b) {
    return edgeKey(mesh.vertexCoordinateKey[a], mesh.vertexCoordinateKey[b]);
}

function bumpEdgeCollapseVertexVersions(mesh, changedVertices) {
    let index = 0;
    let vertex = 0;

    for (index = 0; index < changedVertices.length; index += 1) {
        vertex = changedVertices[index];
        mesh.vertexVersion[vertex] += 1;
    }
}

function pushUniqueEdgeCollapseArrayValue(values, value) {
    if (!edgeCollapseArrayHasValue(values, value)) {
        values.push(value);
    }
}

function edgeCollapseArrayHasValue(values, value) {
    let index = 0;

    for (index = 0; index < values.length; index += 1) {
        if (values[index] === value) {
            return true;
        }
    }

    return false;
}

function pushEdgeCollapseEdgesAroundVertex(mesh, heap, vertex, workspace) {
    let triangles = fillEdgeCollapseVertexTriangles(mesh, vertex, workspace.edgesAroundVertex, workspace.triangleSeen);
    let edgeKeys = workspace.edgeKeys;
    let index = 0;

    edgeKeys.clear();

    for (index = 0; index < triangles.length; index += 1) {
        pushUniqueEdgeCollapseTriangleEdges(mesh, heap, edgeKeys, triangles[index]);
    }
}

function fillEdgeCollapseEdgeTriangles(mesh, a, b, triangles, seen) {
    let source = a;
    let ref = 0;
    let triangleIndex = 0;

    triangles.length = 0;
    beginEdgeCollapseIndexMarker(seen, mesh.triangleActive.length);

    if (mesh.vertexTriangleCount[b] < mesh.vertexTriangleCount[a]) {
        source = b;
    }

    ref = mesh.vertexTriangleHead[source];

    while (ref >= 0) {
        triangleIndex = mesh.vertexTriangleRefTriangle[ref];

        if (edgeCollapseIndexMarkerHas(seen, triangleIndex)) {
            ref = mesh.vertexTriangleRefNext[ref];
            continue;
        }

        markEdgeCollapseIndex(seen, triangleIndex);

        if (mesh.triangleActive[triangleIndex] && triangleContainsVertices(mesh, triangleIndex, a, b)) {
            triangles.push(triangleIndex);
        }

        ref = mesh.vertexTriangleRefNext[ref];
    }

    return triangles;
}

function edgeCollapseEdgeHasTriangle(mesh, a, b) {
    let source = a;
    let ref = 0;
    let triangleIndex = 0;

    if (mesh.vertexTriangleCount[b] < mesh.vertexTriangleCount[a]) {
        source = b;
    }

    ref = mesh.vertexTriangleHead[source];

    while (ref >= 0) {
        triangleIndex = mesh.vertexTriangleRefTriangle[ref];

        if (mesh.triangleActive[triangleIndex] && triangleContainsVertices(mesh, triangleIndex, a, b)) {
            return true;
        }

        ref = mesh.vertexTriangleRefNext[ref];
    }

    return false;
}

function fillEdgeCollapseVertexTriangles(mesh, vertex, triangles, seen) {
    let ref = 0;
    let triangleIndex = 0;

    triangles.length = 0;
    beginEdgeCollapseIndexMarker(seen, mesh.triangleActive.length);

    ref = mesh.vertexTriangleHead[vertex];

    while (ref >= 0) {
        triangleIndex = mesh.vertexTriangleRefTriangle[ref];

        if (edgeCollapseIndexMarkerHas(seen, triangleIndex)) {
            ref = mesh.vertexTriangleRefNext[ref];
            continue;
        }

        markEdgeCollapseIndex(seen, triangleIndex);

        if (mesh.triangleActive[triangleIndex] && triangleContainsVertex(mesh, triangleIndex, vertex)) {
            triangles.push(triangleIndex);
        }

        ref = mesh.vertexTriangleRefNext[ref];
    }

    return triangles;
}

function triangleContainsVertices(mesh, triangleIndex, a, b) {
    return triangleContainsVertex(mesh, triangleIndex, a) && triangleContainsVertex(mesh, triangleIndex, b);
}

function triangleContainsVertex(mesh, triangleIndex, vertex) {
    return mesh.triangleA[triangleIndex] === vertex
        || mesh.triangleB[triangleIndex] === vertex
        || mesh.triangleC[triangleIndex] === vertex;
}

function buildEdgeCollapseMeshPositions(mesh, progressFunc, progressLabel, progressStepIndex, progressStepCount) {
    let positions = new Float32Array(mesh.activeTriangleCount * 9);
    let target = 0;
    let triangleIndex = 0;
    let triangleCount = mesh.triangleActive.length;

    for (triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
        if (!mesh.triangleActive[triangleIndex]) {
            continue;
        }

        target = writeEdgeCollapsePositionVertex(positions, target, mesh, mesh.triangleA[triangleIndex]);
        target = writeEdgeCollapsePositionVertex(positions, target, mesh, mesh.triangleB[triangleIndex]);
        target = writeEdgeCollapsePositionVertex(positions, target, mesh, mesh.triangleC[triangleIndex]);

        if (triangleIndex % 8192 === 0) {
            reportReduceProgress(progressFunc, progressLabel, triangleIndex / Math.max(triangleCount, 1), progressStepIndex, progressStepCount);
        }
    }

    reportReduceProgress(progressFunc, progressLabel, 1.0, progressStepIndex, progressStepCount);

    return positions;
}

function writeEdgeCollapsePositionVertex(positions, target, mesh, vertex) {
    positions[target] = mesh.vertexX[vertex];
    positions[target + 1] = mesh.vertexY[vertex];
    positions[target + 2] = mesh.vertexZ[vertex];

    return target + 3;
}

function normalizePositions(sourcePositions) {
    if (sourcePositions instanceof Float32Array) {
        return sourcePositions;
    }

    return new Float32Array(sourcePositions);
}

function createReduceResult(positions, originalTriangleCount, triangleCount, fallbackApplied, originalBadEdgeCount, finalBadEdgeCount, finalGuardRejected) {
    return {
        positions: positions,
        triangleCount: triangleCount,
        originalTriangleCount: originalTriangleCount,
        fallbackApplied: fallbackApplied,
        originalBadEdgeCount: originalBadEdgeCount,
        finalBadEdgeCount: finalBadEdgeCount,
        finalGuardRejected: finalGuardRejected
    };
}

function addWeldedVertex(positions, source, tolerance, vertexMap, coordinateIds, mesh) {
    let x = positions[source];
    let y = positions[source + 1];
    let z = positions[source + 2];
    let ix = Math.round(x / tolerance);
    let iy = Math.round(y / tolerance);
    let iz = Math.round(z / tolerance);
    let existing = findWeldedVertex(vertexMap, mesh, x, y, z, ix, iy, iz, tolerance);
    let bucket = null;
    let index = 0;

    if (existing >= 0) {
        return existing;
    }

    index = mesh.vertexCount;
    mesh.vertexCount += 1;
    bucket = getOrCreateCoordinateBucket(vertexMap, ix, iy, iz);
    bucket.push(index);
    mesh.vertexX[index] = x;
    mesh.vertexY[index] = y;
    mesh.vertexZ[index] = z;
    mesh.vertexCoordinateKey[index] = coordinateIdForPosition(coordinateIds, x, y, z);
    mesh.vertexActive[index] = 1;

    return index;
}

function addCoordinateWeldedVertex(positions, source, vertexMap, coordinateIds, mesh) {
    let x = positions[source];
    let y = positions[source + 1];
    let z = positions[source + 2];
    let coordinateKey = coordinateIdForPosition(coordinateIds, x, y, z);
    let existing = vertexMap.get(coordinateKey);
    let index = 0;

    if (typeof existing === "number") {
        return existing;
    }

    index = mesh.vertexCount;
    mesh.vertexCount += 1;
    vertexMap.set(coordinateKey, index);
    mesh.vertexX[index] = x;
    mesh.vertexY[index] = y;
    mesh.vertexZ[index] = z;
    mesh.vertexCoordinateKey[index] = coordinateKey;
    mesh.vertexActive[index] = 1;

    return index;
}

function findWeldedVertex(vertexMap, mesh, x, y, z, ix, iy, iz, tolerance) {
    let dx = -1;
    let dy = -1;
    let dz = -1;
    let bucket = null;
    let candidate = 0;

    bucket = getCoordinateBucket(vertexMap, ix, iy, iz);

    if (bucket) {
        candidate = findWeldedVertexInBucket(bucket, mesh, x, y, z, tolerance);

        if (candidate >= 0) {
            return candidate;
        }
    }

    for (dx = -1; dx <= 1; dx += 1) {
        for (dy = -1; dy <= 1; dy += 1) {
            for (dz = -1; dz <= 1; dz += 1) {
                if (dx === 0 && dy === 0 && dz === 0) {
                    continue;
                }

                bucket = getCoordinateBucket(vertexMap, ix + dx, iy + dy, iz + dz);

                if (!bucket) {
                    continue;
                }

                candidate = findWeldedVertexInBucket(bucket, mesh, x, y, z, tolerance);

                if (candidate >= 0) {
                    return candidate;
                }
            }
        }
    }

    return -1;
}

function findWeldedVertexInBucket(bucket, mesh, x, y, z, tolerance) {
    let bucketIndex = 0;
    let candidate = 0;

    for (bucketIndex = 0; bucketIndex < bucket.length; bucketIndex += 1) {
        candidate = bucket[bucketIndex];

        if (pointsWithinWeldTolerance(mesh.vertexX[candidate], mesh.vertexY[candidate], mesh.vertexZ[candidate], x, y, z, tolerance)) {
            return candidate;
        }
    }

    return -1;
}

function createCoordinateIdStore() {
    return {
        root: new Map(),
        nextId: 0
    };
}

function coordinateIdForPosition(store, x, y, z) {
    return coordinateIdForRoundedPoint(
        store,
        Math.round(x * positionVertexScale),
        Math.round(y * positionVertexScale),
        Math.round(z * positionVertexScale)
    );
}

function coordinateIdForRoundedPoint(store, x, y, z) {
    let yMap = getOrCreateNestedCoordinateMap(store.root, x);
    let zMap = getOrCreateNestedCoordinateMap(yMap, y);
    let id = zMap.get(z);

    if (typeof id === "number") {
        return id;
    }

    id = store.nextId;
    store.nextId += 1;
    zMap.set(z, id);
    return id;
}

function getCoordinateBucket(root, x, y, z) {
    let yMap = root.get(x);
    let zMap = null;

    if (!yMap) {
        return null;
    }

    zMap = yMap.get(y);

    if (!zMap) {
        return null;
    }

    return zMap.get(z);
}

function getOrCreateCoordinateBucket(root, x, y, z) {
    let yMap = getOrCreateNestedCoordinateMap(root, x);
    let zMap = getOrCreateNestedCoordinateMap(yMap, y);
    let bucket = zMap.get(z);

    if (!bucket) {
        bucket = [];
        zMap.set(z, bucket);
    }

    return bucket;
}

function getOrCreateNestedCoordinateMap(map, key) {
    let nested = map.get(key);

    if (!nested) {
        nested = new Map();
        map.set(key, nested);
    }

    return nested;
}

function pointsWithinWeldTolerance(ax, ay, az, bx, by, bz, tolerance) {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;

    return dx * dx + dy * dy + dz * dz <= tolerance * tolerance;
}

function edgeKey(a, b) {
    let first = a;
    let second = b;
    let sum = 0;

    if (b < a) {
        first = b;
        second = a;
    }

    sum = first + second;
    return sum * (sum + 1) * 0.5 + second;
}

function estimateWeldTolerance(positions, progressFunc, progressLabel, progressStepIndex, progressStepCount) {
    let index = 0;
    let maxAbs = 1.0;
    let value = 0.0;

    for (index = 0; index < positions.length; index += 1) {
        value = Math.abs(positions[index]);

        if (value > maxAbs) {
            maxAbs = value;
        }

        if (index % 65536 === 0) {
            reportReduceProgress(progressFunc, progressLabel, index / Math.max(positions.length, 1), progressStepIndex, progressStepCount);
        }
    }

    reportReduceProgress(progressFunc, progressLabel, 1.0, progressStepIndex, progressStepCount);

    return Math.max(0.00005, maxAbs * 0.000001);
}

function countMeshEdgeStats(positions, progressFunc, progressLabel, progressStepIndex, progressStepCount) {
    let edgeCounts = new Map();
    let coordinateIds = createCoordinateIdStore();
    let index = 0;
    let badEdgeCount = 0;
    let overusedEdgeCount = 0;
    let count = 0;
    let edgeIndex = 0;
    let edgeCount = 0;
    let triangleStep = 4096 * 9;

    for (index = 0; index < positions.length; index += 9) {
        addPositionEdgeCount(edgeCounts, coordinateIds, positions, index, index + 3);
        addPositionEdgeCount(edgeCounts, coordinateIds, positions, index + 3, index + 6);
        addPositionEdgeCount(edgeCounts, coordinateIds, positions, index + 6, index);

        if (index % triangleStep === 0) {
            reportReduceProgressRange(progressFunc, progressLabel, index / Math.max(positions.length, 1), 0.0, 0.75, progressStepIndex, progressStepCount);
        }
    }

    edgeCount = edgeCounts.size;

    for (count of edgeCounts.values()) {
        if (count !== 2) {
            badEdgeCount += 1;
        }

        if (count > 2) {
            overusedEdgeCount += 1;
        }

        if (edgeIndex % 8192 === 0) {
            reportReduceProgressRange(progressFunc, progressLabel, edgeIndex / Math.max(edgeCount, 1), 0.75, 1.0, progressStepIndex, progressStepCount);
        }

        edgeIndex += 1;
    }

    reportReduceProgress(progressFunc, progressLabel, 1.0, progressStepIndex, progressStepCount);

    return {
        badEdgeCount: badEdgeCount,
        overusedEdgeCount: overusedEdgeCount
    };
}

function addPositionEdgeCount(edgeCounts, coordinateIds, positions, firstIndex, secondIndex) {
    let first = coordinateIdForPosition(coordinateIds, positions[firstIndex], positions[firstIndex + 1], positions[firstIndex + 2]);
    let second = coordinateIdForPosition(coordinateIds, positions[secondIndex], positions[secondIndex + 1], positions[secondIndex + 2]);
    let key = edgeKey(first, second);
    let count = 0;

    count = edgeCounts.get(key);

    if (!count) {
        count = 0;
    }

    edgeCounts.set(key, count + 1);
}

function reportReduceProgress(progressFunc, label, progressValue, stepIndex, stepCount) {
    let cleanStepIndex = Math.floor(Number(stepIndex));
    let cleanStepCount = Math.floor(Number(stepCount));

    if (!progressFunc) {
        return;
    }

    if (!Number.isFinite(cleanStepIndex) || cleanStepIndex < 1) {
        cleanStepIndex = 1;
    }

    if (!Number.isFinite(cleanStepCount) || cleanStepCount < cleanStepIndex) {
        cleanStepCount = cleanStepIndex;
    }

    progressFunc(label, Math.min(Math.max(progressValue, 0.0), 1.0), cleanStepIndex, cleanStepCount);
}

function reportReduceProgressRange(progressFunc, label, progressValue, progressStart, progressEnd, stepIndex, stepCount) {
    let cleanValue = 0.0;

    if (!progressFunc || !Number.isFinite(progressStart) || !Number.isFinite(progressEnd)) {
        return;
    }

    cleanValue = progressStart + (progressEnd - progressStart) * progressValue;
    reportReduceProgress(progressFunc, label, cleanValue, stepIndex, stepCount);
}
