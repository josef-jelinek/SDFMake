import { cleanMeshMethod, cleanSubdivisionsValue, meshMethodLabel } from "./settings.js";

const cubeCornerX = new Int8Array([0, 1, 1, 0, 0, 1, 1, 0]);
const cubeCornerY = new Int8Array([0, 0, 1, 1, 0, 0, 1, 1]);
const cubeCornerZ = new Int8Array([0, 0, 0, 0, 1, 1, 1, 1]);
const cubeEdgeA = new Int8Array([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]);
const cubeEdgeB = new Int8Array([1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7]);
const cubeFaceCorners = new Int8Array([
    0, 1, 2, 3,
    4, 5, 6, 7,
    0, 1, 5, 4,
    3, 2, 6, 7,
    0, 3, 7, 4,
    1, 2, 6, 5
]);
const cubeFaceEdges = new Int8Array([
    0, 1, 2, 3,
    4, 5, 6, 7,
    0, 9, 4, 8,
    2, 10, 6, 11,
    3, 11, 7, 8,
    1, 10, 5, 9
]);
const marchingTetraEvenCorners = new Int8Array([
    0, 2, 5, 7,
    0, 1, 2, 5,
    0, 3, 2, 7,
    0, 4, 5, 7,
    2, 5, 6, 7
]);
const marchingTetraOddCorners = new Int8Array([
    1, 3, 4, 6,
    0, 1, 3, 4,
    1, 2, 3, 6,
    1, 4, 5, 6,
    3, 4, 6, 7
]);
const voxelEdgeBridgeOffsets = new Int8Array([
    1, 1, 0,
    1, -1, 0,
    1, 0, 1,
    1, 0, -1,
    0, 1, 1,
    0, 1, -1
]);
const voxelCornerBridgeOffsets = new Int8Array([
    1, 1, 1,
    1, 1, -1,
    1, -1, 1,
    1, -1, -1
]);
const contourTriangleRefineDepth = 3;
const contourTriangleRefineErrorScale = 0.04;
const voxelOccupancyThreshold = 0.5;
const voxelBridgeChamferScale = 0.10;
let shiftedVoxelTileTable = null;

export function buildMesh(sampleFunc, resolution, bound, method, progressFunc, subdivisions) {
    let cellCount = cleanResolution(resolution);
    let cleanBounds = cleanMeshBounds(bound);
    let cleanMethod = cleanMeshMethod(method);
    let methodLabel = meshMethodLabel(cleanMethod);
    let step = cleanBounds.size / cellCount;
    let cleanSubdivisions = cleanSubdivisionsValue(subdivisions);
    let cleanMinimumFeatureSize = step / cleanSubdivisions;

    if (cleanMethod === "contour-fit") {
        return buildContourFitMesh(sampleFunc, cellCount, cleanBounds, cleanMethod, methodLabel, cleanMinimumFeatureSize, cleanSubdivisions, progressFunc);
    }

    if (cleanMethod === "marching-tetrahedra") {
        return buildMarchingTetrahedraMesh(sampleFunc, cellCount, cleanBounds, cleanMethod, methodLabel, cleanMinimumFeatureSize, cleanSubdivisions, progressFunc);
    }

    if (cleanMethod === "voxel") {
        return buildVoxelOccupancyMesh(sampleFunc, cellCount, cleanBounds, cleanMethod, methodLabel, cleanMinimumFeatureSize, cleanSubdivisions, progressFunc, emitSharpVoxelBridgeMesh);
    }

    if (cleanMethod === "voxel-blend") {
        return buildVoxelOccupancyMesh(sampleFunc, cellCount, cleanBounds, cleanMethod, methodLabel, cleanMinimumFeatureSize, cleanSubdivisions, progressFunc, emitShiftedVoxelBlendMesh);
    }

    return buildContourFitMesh(sampleFunc, cellCount, cleanBounds, "contour-fit", methodLabel, cleanMinimumFeatureSize, cleanSubdivisions, progressFunc);
}

function buildVoxelOccupancyMesh(sampleFunc, cellCount, cleanBounds, method, methodLabel, minimumFeatureSize, subdivisions, progressFunc, emitFunc) {
    let step = cleanBounds.size / cellCount;
    let occupied = new Uint8Array(cellCount * cellCount * cellCount);
    let positions = [];
    let occupiedCellCount = 0;

    classifyVoxelCells(occupied, sampleFunc, cellCount, cleanBounds, subdivisions, progressFunc);
    reportMeshProgress(progressFunc, "Preparing voxel geometry", 1.0, 2, 3);
    occupiedCellCount = countOccupiedVoxelCells(occupied);
    emitFunc(occupied, cellCount, cleanBounds, positions, progressFunc);
    reportMeshProgress(progressFunc, methodLabel, 1.0, 3, 3);

    return {
        positions: new Float32Array(positions),
        triangleCount: positions.length / 9,
        resolution: cellCount,
        cellSize: step,
        minimumFeatureSize: minimumFeatureSize,
        subdivisions: subdivisions,
        voxelOccupiedCellCount: occupiedCellCount,
        bound: cleanBounds.boundValue,
        padding: cleanBounds.padding,
        minX: cleanBounds.minX,
        minY: cleanBounds.minY,
        minZ: cleanBounds.minZ,
        maxX: cleanBounds.minX + cleanBounds.size,
        maxY: cleanBounds.minY + cleanBounds.size,
        maxZ: cleanBounds.minZ + cleanBounds.size,
        method: method,
        methodLabel: methodLabel
    };
}

function classifyVoxelCells(occupied, sampleFunc, cellCount, cleanBounds, subdivisions, progressFunc) {
    let step = cleanBounds.size / cellCount;
    let xIndex = 0;
    let yIndex = 0;
    let zIndex = 0;
    let offset = 0;
    let score = 0.0;

    reportMeshProgress(progressFunc, "Sampling voxel occupancy", 0.0, 1, 3);

    for (zIndex = 0; zIndex < cellCount; zIndex += 1) {
        for (yIndex = 0; yIndex < cellCount; yIndex += 1) {
            for (xIndex = 0; xIndex < cellCount; xIndex += 1) {
                offset = cellIndex(xIndex, yIndex, zIndex, cellCount);
                score = sampleVoxelOccupancy(
                    sampleFunc,
                    cleanBounds.minX + xIndex * step,
                    cleanBounds.minY + yIndex * step,
                    cleanBounds.minZ + zIndex * step,
                    step,
                    subdivisions
                );

                if (score >= voxelOccupancyThreshold) {
                    occupied[offset] = 1;
                }
            }
        }

        reportMeshProgress(progressFunc, "Sampling voxel occupancy", (zIndex + 1) / cellCount, 1, 3);
    }
}

function sampleVoxelOccupancy(sampleFunc, x, y, z, step, subdivisions) {
    let xIndex = 0;
    let yIndex = 0;
    let zIndex = 0;
    let sampleCount = subdivisions * subdivisions * subdivisions;
    let insideCount = 0;
    let sampleStep = step / subdivisions;
    let px = 0.0;
    let py = 0.0;
    let pz = 0.0;

    for (zIndex = 0; zIndex < subdivisions; zIndex += 1) {
        pz = z + (zIndex + 0.5) * sampleStep;

        for (yIndex = 0; yIndex < subdivisions; yIndex += 1) {
            py = y + (yIndex + 0.5) * sampleStep;

            for (xIndex = 0; xIndex < subdivisions; xIndex += 1) {
                px = x + (xIndex + 0.5) * sampleStep;

                if (sampleFunc(px, py, pz) <= 0.0) {
                    insideCount += 1;
                }
            }
        }
    }

    return insideCount / sampleCount;
}

function countOccupiedVoxelCells(occupied) {
    let index = 0;
    let count = 0;

    for (index = 0; index < occupied.length; index += 1) {
        if (occupied[index]) {
            count += 1;
        }
    }

    return count;
}

function voxelGreedyFaceWidth(mask, cellCount, u, v) {
    let width = 0;

    while (u + width < cellCount && mask[v * cellCount + u + width]) {
        width += 1;
    }

    return width;
}

function voxelGreedyFaceHeight(mask, cellCount, u, v, width) {
    let height = 1;
    let checkU = 0;
    let rowOk = true;

    while (v + height < cellCount) {
        rowOk = true;

        for (checkU = 0; checkU < width; checkU += 1) {
            if (!mask[(v + height) * cellCount + u + checkU]) {
                rowOk = false;
                break;
            }
        }

        if (!rowOk) {
            break;
        }

        height += 1;
    }

    return height;
}

function clearVoxelFaceMaskRectangle(mask, cellCount, u, v, width, height) {
    let xIndex = 0;
    let yIndex = 0;

    for (yIndex = 0; yIndex < height; yIndex += 1) {
        for (xIndex = 0; xIndex < width; xIndex += 1) {
            mask[(v + yIndex) * cellCount + u + xIndex] = 0;
        }
    }
}

function pushVoxelBoundaryPoint(pointX, pointY, pointZ, x, y, z) {
    pointX.push(x);
    pointY.push(y);
    pointZ.push(z);
}

function emitVoxelBoundaryFan(positions, pointX, pointY, pointZ) {
    let index = 0;
    let nextIndex = 0;
    let centerX = 0.0;
    let centerY = 0.0;
    let centerZ = 0.0;

    if (pointX.length < 3) {
        return;
    }

    for (index = 0; index < pointX.length; index += 1) {
        centerX += pointX[index];
        centerY += pointY[index];
        centerZ += pointZ[index];
    }

    centerX /= pointX.length;
    centerY /= pointY.length;
    centerZ /= pointZ.length;

    for (index = 0; index < pointX.length; index += 1) {
        nextIndex = index + 1;

        if (nextIndex >= pointX.length) {
            nextIndex = 0;
        }

        pushTriangleCoordinates(
            positions,
            centerX,
            centerY,
            centerZ,
            pointX[index],
            pointY[index],
            pointZ[index],
            pointX[nextIndex],
            pointY[nextIndex],
            pointZ[nextIndex]
        );
    }
}

function emitSharpVoxelBridgeMesh(occupied, cellCount, cleanBounds, positions, progressFunc) {
    let boxes = createVoxelBridgeBoxes(occupied, cellCount);
    let compressed = createCompressedVoxelGrid(boxes, cellCount);

    reportMeshProgress(progressFunc, "Merging voxel faces", 0.0, 3, 3);
    fillCompressedVoxelGrid(compressed, boxes);
    emitCompressedVoxelGridFaces(compressed, cleanBounds, cellCount, positions, progressFunc);
}

function createVoxelBridgeBoxes(occupied, cellCount) {
    let boxes = createVoxelBoxSet();
    let bridgeSize = voxelBridgeChamferScale;
    let xIndex = 0;
    let yIndex = 0;
    let zIndex = 0;

    for (zIndex = 0; zIndex < cellCount; zIndex += 1) {
        for (yIndex = 0; yIndex < cellCount; yIndex += 1) {
            for (xIndex = 0; xIndex < cellCount; xIndex += 1) {
                if (!voxelCellIsOccupied(occupied, cellCount, xIndex, yIndex, zIndex)) {
                    continue;
                }

                addVoxelBridgeBox(boxes, xIndex, yIndex, zIndex, xIndex + 1.0, yIndex + 1.0, zIndex + 1.0);
                addVoxelEdgeBridgeBoxes(boxes, occupied, cellCount, xIndex, yIndex, zIndex, bridgeSize);
                addVoxelCornerBridgeBoxes(boxes, occupied, cellCount, xIndex, yIndex, zIndex, bridgeSize);
            }
        }
    }

    return boxes;
}

function createVoxelBoxSet() {
    return {
        minX: [],
        minY: [],
        minZ: [],
        maxX: [],
        maxY: [],
        maxZ: [],
        xCoords: [],
        yCoords: [],
        zCoords: []
    };
}

function addVoxelEdgeBridgeBoxes(boxes, occupied, cellCount, xIndex, yIndex, zIndex, bridgeSize) {
    let offsetIndex = 0;
    let dx = 0;
    let dy = 0;
    let dz = 0;

    for (offsetIndex = 0; offsetIndex < voxelEdgeBridgeOffsets.length; offsetIndex += 3) {
        dx = voxelEdgeBridgeOffsets[offsetIndex];
        dy = voxelEdgeBridgeOffsets[offsetIndex + 1];
        dz = voxelEdgeBridgeOffsets[offsetIndex + 2];

        if (!voxelCellIsOccupied(occupied, cellCount, xIndex + dx, yIndex + dy, zIndex + dz)) {
            continue;
        }

        if (!voxelEdgeBridgeIsNeeded(occupied, cellCount, xIndex, yIndex, zIndex, dx, dy, dz)) {
            continue;
        }

        addVoxelContactBridgeBox(boxes, xIndex, yIndex, zIndex, dx, dy, dz, bridgeSize);
    }
}

function addVoxelCornerBridgeBoxes(boxes, occupied, cellCount, xIndex, yIndex, zIndex, bridgeSize) {
    let offsetIndex = 0;
    let dx = 0;
    let dy = 0;
    let dz = 0;

    for (offsetIndex = 0; offsetIndex < voxelCornerBridgeOffsets.length; offsetIndex += 3) {
        dx = voxelCornerBridgeOffsets[offsetIndex];
        dy = voxelCornerBridgeOffsets[offsetIndex + 1];
        dz = voxelCornerBridgeOffsets[offsetIndex + 2];

        if (!voxelCellIsOccupied(occupied, cellCount, xIndex + dx, yIndex + dy, zIndex + dz)) {
            continue;
        }

        if (!voxelCornerBridgeIsNeeded(occupied, cellCount, xIndex, yIndex, zIndex, dx, dy, dz)) {
            continue;
        }

        addVoxelContactBridgeBox(boxes, xIndex, yIndex, zIndex, dx, dy, dz, bridgeSize);
    }
}

// Emits connector volume only for edge-touching voxels that are not already joined by a face-neighbor around the same edge.
function voxelEdgeBridgeIsNeeded(occupied, cellCount, xIndex, yIndex, zIndex, dx, dy, dz) {
    if (dx !== 0 && dy !== 0) {
        return !voxelCellIsOccupied(occupied, cellCount, xIndex + dx, yIndex, zIndex)
            && !voxelCellIsOccupied(occupied, cellCount, xIndex, yIndex + dy, zIndex);
    } else if (dx !== 0 && dz !== 0) {
        return !voxelCellIsOccupied(occupied, cellCount, xIndex + dx, yIndex, zIndex)
            && !voxelCellIsOccupied(occupied, cellCount, xIndex, yIndex, zIndex + dz);
    } else if (dy !== 0 && dz !== 0) {
        return !voxelCellIsOccupied(occupied, cellCount, xIndex, yIndex + dy, zIndex)
            && !voxelCellIsOccupied(occupied, cellCount, xIndex, yIndex, zIndex + dz);
    }

    return true;
}

// A corner bridge is needed only when the diagonal cells are separate face-connected components in their local 2x2x2 block.
function voxelCornerBridgeIsNeeded(occupied, cellCount, xIndex, yIndex, zIndex, dx, dy, dz) {
    let mask = voxelCornerContactMask(occupied, cellCount, xIndex, yIndex, zIndex, dx, dy, dz);
    let connected = connectedVoxelMaskComponent(mask, 0);

    return (connected & 128) === 0;
}

function voxelCornerContactMask(occupied, cellCount, xIndex, yIndex, zIndex, dx, dy, dz) {
    let mask = 0;
    let bit = 0;
    let cellX = 0;
    let cellY = 0;
    let cellZ = 0;

    for (bit = 0; bit < 8; bit += 1) {
        cellX = xIndex + voxelLocalX(bit) * dx;
        cellY = yIndex + voxelLocalY(bit) * dy;
        cellZ = zIndex + voxelLocalZ(bit) * dz;

        if (voxelCellIsOccupied(occupied, cellCount, cellX, cellY, cellZ)) {
            mask |= 1 << bit;
        }
    }

    return mask;
}

function addVoxelContactBridgeBox(boxes, xIndex, yIndex, zIndex, dx, dy, dz, bridgeSize) {
    let minX = voxelBridgeAxisMin(xIndex, dx, bridgeSize);
    let minY = voxelBridgeAxisMin(yIndex, dy, bridgeSize);
    let minZ = voxelBridgeAxisMin(zIndex, dz, bridgeSize);
    let maxX = voxelBridgeAxisMax(xIndex, dx, bridgeSize);
    let maxY = voxelBridgeAxisMax(yIndex, dy, bridgeSize);
    let maxZ = voxelBridgeAxisMax(zIndex, dz, bridgeSize);

    addVoxelBridgeBox(boxes, minX, minY, minZ, maxX, maxY, maxZ);
}

function voxelBridgeAxisMin(index, offset, bridgeSize) {
    if (offset > 0) {
        return index + 1.0 - bridgeSize;
    }

    if (offset < 0) {
        return index - bridgeSize;
    }

    return index;
}

function voxelBridgeAxisMax(index, offset, bridgeSize) {
    if (offset > 0) {
        return index + 1.0 + bridgeSize;
    }

    if (offset < 0) {
        return index + bridgeSize;
    }

    return index + 1.0;
}

function addVoxelBridgeBox(boxes, minX, minY, minZ, maxX, maxY, maxZ) {
    if (minX >= maxX || minY >= maxY || minZ >= maxZ) {
        return;
    }

    boxes.minX.push(minX);
    boxes.minY.push(minY);
    boxes.minZ.push(minZ);
    boxes.maxX.push(maxX);
    boxes.maxY.push(maxY);
    boxes.maxZ.push(maxZ);
    boxes.xCoords.push(minX);
    boxes.xCoords.push(maxX);
    boxes.yCoords.push(minY);
    boxes.yCoords.push(maxY);
    boxes.zCoords.push(minZ);
    boxes.zCoords.push(maxZ);
}

function createCompressedVoxelGrid(boxes, cellCount) {
    let xCoords = sortedUniqueVoxelCoordinates(boxes.xCoords);
    let yCoords = sortedUniqueVoxelCoordinates(boxes.yCoords);
    let zCoords = sortedUniqueVoxelCoordinates(boxes.zCoords);
    let xMap = createVoxelCoordinateMap(xCoords);
    let yMap = createVoxelCoordinateMap(yCoords);
    let zMap = createVoxelCoordinateMap(zCoords);
    let xCellCount = Math.max(xCoords.length - 1, 1);
    let yCellCount = Math.max(yCoords.length - 1, 1);
    let zCellCount = Math.max(zCoords.length - 1, 1);

    if (xCoords.length === 0) {
        xCoords.push(0.0);
        xCoords.push(cellCount);
    }

    if (yCoords.length === 0) {
        yCoords.push(0.0);
        yCoords.push(cellCount);
    }

    if (zCoords.length === 0) {
        zCoords.push(0.0);
        zCoords.push(cellCount);
    }

    return {
        xCoords: xCoords,
        yCoords: yCoords,
        zCoords: zCoords,
        xMap: xMap,
        yMap: yMap,
        zMap: zMap,
        xCellCount: xCellCount,
        yCellCount: yCellCount,
        zCellCount: zCellCount,
        occupied: new Uint8Array(xCellCount * yCellCount * zCellCount)
    };
}

function sortedUniqueVoxelCoordinates(values) {
    let sorted = values.slice();
    let unique = [];
    let index = 0;
    let value = 0.0;
    let previous = NaN;

    sorted.sort(compareNumbers);

    for (index = 0; index < sorted.length; index += 1) {
        value = sorted[index];

        if (!Number.isFinite(value)) {
            continue;
        }

        if (unique.length === 0 || Math.abs(value - previous) > 0.000000001) {
            unique.push(value);
            previous = value;
        }
    }

    return unique;
}

function compareNumbers(first, second) {
    if (first < second) {
        return -1;
    }

    if (first > second) {
        return 1;
    }

    return 0;
}

function createVoxelCoordinateMap(coords) {
    let map = new Map();
    let index = 0;

    for (index = 0; index < coords.length; index += 1) {
        map.set(voxelCoordinateKey(coords[index]), index);
    }

    return map;
}

function voxelCoordinateKey(value) {
    return value.toFixed(9);
}

function fillCompressedVoxelGrid(compressed, boxes) {
    let boxIndex = 0;
    let xStart = 0;
    let xEnd = 0;
    let yStart = 0;
    let yEnd = 0;
    let zStart = 0;
    let zEnd = 0;
    let xIndex = 0;
    let yIndex = 0;
    let zIndex = 0;

    for (boxIndex = 0; boxIndex < boxes.minX.length; boxIndex += 1) {
        xStart = compressed.xMap.get(voxelCoordinateKey(boxes.minX[boxIndex]));
        xEnd = compressed.xMap.get(voxelCoordinateKey(boxes.maxX[boxIndex]));
        yStart = compressed.yMap.get(voxelCoordinateKey(boxes.minY[boxIndex]));
        yEnd = compressed.yMap.get(voxelCoordinateKey(boxes.maxY[boxIndex]));
        zStart = compressed.zMap.get(voxelCoordinateKey(boxes.minZ[boxIndex]));
        zEnd = compressed.zMap.get(voxelCoordinateKey(boxes.maxZ[boxIndex]));

        for (zIndex = zStart; zIndex < zEnd; zIndex += 1) {
            for (yIndex = yStart; yIndex < yEnd; yIndex += 1) {
                for (xIndex = xStart; xIndex < xEnd; xIndex += 1) {
                    compressed.occupied[compressedVoxelIndex(compressed, xIndex, yIndex, zIndex)] = 1;
                }
            }
        }
    }
}

function emitCompressedVoxelGridFaces(compressed, cleanBounds, cellCount, positions, progressFunc) {
    let direction = 0;

    scaleCompressedVoxelCoordinates(compressed.xCoords, cleanBounds.minX, cleanBounds.size / cellCount);
    scaleCompressedVoxelCoordinates(compressed.yCoords, cleanBounds.minY, cleanBounds.size / cellCount);
    scaleCompressedVoxelCoordinates(compressed.zCoords, cleanBounds.minZ, cleanBounds.size / cellCount);

    for (direction = 0; direction < 6; direction += 1) {
        emitCompressedVoxelFacesForDirection(compressed, positions, direction);
        reportMeshProgress(progressFunc, "Merging voxel faces", (direction + 1) / 6.0, 3, 3);
    }
}

function scaleCompressedVoxelCoordinates(coords, origin, step) {
    let index = 0;

    for (index = 0; index < coords.length; index += 1) {
        coords[index] = origin + coords[index] * step;
    }
}

function emitCompressedVoxelFacesForDirection(compressed, positions, direction) {
    let maskWidth = compressedFaceMaskWidth(compressed, direction);
    let maskHeight = compressedFaceMaskHeight(compressed, direction);
    let sliceCount = compressedFaceSliceCount(compressed, direction);
    let mask = new Uint8Array(maskWidth * maskHeight);
    let slice = 0;
    let u = 0;
    let v = 0;
    let width = 0;
    let height = 0;
    let maskOffset = 0;

    for (slice = 0; slice < sliceCount; slice += 1) {
        fillCompressedVoxelFaceMask(mask, compressed, direction, slice);

        for (v = 0; v < maskHeight; v += 1) {
            for (u = 0; u < maskWidth; u += 1) {
                maskOffset = v * maskWidth + u;

                if (!mask[maskOffset]) {
                    continue;
                }

                width = voxelGreedyFaceWidth(mask, maskWidth, u, v);
                height = voxelGreedyFaceHeight(mask, maskWidth, u, v, width);
                clearVoxelFaceMaskRectangle(mask, maskWidth, u, v, width, height);
                emitCompressedVoxelFaceRectangle(positions, compressed, direction, slice, u, v, width, height);
            }
        }
    }
}

function compressedFaceMaskWidth(compressed, direction) {
    if (direction < 2) {
        return compressed.yCellCount;
    }

    return compressed.xCellCount;
}

function compressedFaceMaskHeight(compressed, direction) {
    if (direction < 4) {
        return compressed.zCellCount;
    }

    return compressed.yCellCount;
}

function compressedFaceSliceCount(compressed, direction) {
    if (direction < 2) {
        return compressed.xCellCount;
    }

    if (direction < 4) {
        return compressed.yCellCount;
    }

    return compressed.zCellCount;
}

function fillCompressedVoxelFaceMask(mask, compressed, direction, slice) {
    let maskWidth = compressedFaceMaskWidth(compressed, direction);
    let maskHeight = compressedFaceMaskHeight(compressed, direction);
    let u = 0;
    let v = 0;
    let xIndex = 0;
    let yIndex = 0;
    let zIndex = 0;

    mask.fill(0);

    for (v = 0; v < maskHeight; v += 1) {
        for (u = 0; u < maskWidth; u += 1) {
            if (direction < 2) {
                xIndex = slice;
                yIndex = u;
                zIndex = v;
            } else if (direction < 4) {
                xIndex = u;
                yIndex = slice;
                zIndex = v;
            } else {
                xIndex = u;
                yIndex = v;
                zIndex = slice;
            }

            if (compressedVoxelFaceVisible(compressed, xIndex, yIndex, zIndex, direction)) {
                mask[v * maskWidth + u] = 1;
            }
        }
    }
}

function compressedVoxelFaceVisible(compressed, xIndex, yIndex, zIndex, direction) {
    let neighborX = xIndex;
    let neighborY = yIndex;
    let neighborZ = zIndex;

    if (!compressed.occupied[compressedVoxelIndex(compressed, xIndex, yIndex, zIndex)]) {
        return false;
    }

    switch (direction) {
        case 0:
            neighborX -= 1;
            break;
        case 1:
            neighborX += 1;
            break;
        case 2:
            neighborY -= 1;
            break;
        case 3:
            neighborY += 1;
            break;
        case 4:
            neighborZ -= 1;
            break;
        default:
            neighborZ += 1;
            break;
    }

    if (neighborX < 0 || neighborY < 0 || neighborZ < 0 || neighborX >= compressed.xCellCount || neighborY >= compressed.yCellCount || neighborZ >= compressed.zCellCount) {
        return true;
    }

    return !compressed.occupied[compressedVoxelIndex(compressed, neighborX, neighborY, neighborZ)];
}

function compressedVoxelIndex(compressed, xIndex, yIndex, zIndex) {
    return zIndex * compressed.xCellCount * compressed.yCellCount + yIndex * compressed.xCellCount + xIndex;
}

function emitCompressedVoxelFaceRectangle(positions, compressed, direction, slice, u, v, width, height) {
    if (direction < 2) {
        emitCompressedVoxelXFaceRectangle(positions, compressed, direction, slice, u, v, width, height);
        return;
    }

    if (direction < 4) {
        emitCompressedVoxelYFaceRectangle(positions, compressed, direction, slice, u, v, width, height);
        return;
    }

    emitCompressedVoxelZFaceRectangle(positions, compressed, direction, slice, u, v, width, height);
}

function emitCompressedVoxelXFaceRectangle(positions, compressed, direction, slice, u, v, width, height) {
    let pointX = [];
    let pointY = [];
    let pointZ = [];
    let x = compressed.xCoords[slice];
    let y0 = compressed.yCoords[u];
    let y1 = compressed.yCoords[u + width];
    let z0 = compressed.zCoords[v];
    let z1 = compressed.zCoords[v + height];
    let index = 0;

    if (direction === 1) {
        x = compressed.xCoords[slice + 1];
    }

    if (direction === 0) {
        for (index = v; index < v + height; index += 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, x, y0, compressed.zCoords[index]);
        }

        for (index = u; index < u + width; index += 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, x, compressed.yCoords[index], z1);
        }

        for (index = v + height; index > v; index -= 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, x, y1, compressed.zCoords[index]);
        }

        for (index = u + width; index > u; index -= 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, x, compressed.yCoords[index], z0);
        }

        emitVoxelBoundaryFan(positions, pointX, pointY, pointZ);
        return;
    }

    for (index = u; index < u + width; index += 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, x, compressed.yCoords[index], z0);
    }

    for (index = v; index < v + height; index += 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, x, y1, compressed.zCoords[index]);
    }

    for (index = u + width; index > u; index -= 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, x, compressed.yCoords[index], z1);
    }

    for (index = v + height; index > v; index -= 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, x, y0, compressed.zCoords[index]);
    }

    emitVoxelBoundaryFan(positions, pointX, pointY, pointZ);
}

function emitCompressedVoxelYFaceRectangle(positions, compressed, direction, slice, u, v, width, height) {
    let pointX = [];
    let pointY = [];
    let pointZ = [];
    let x0 = compressed.xCoords[u];
    let x1 = compressed.xCoords[u + width];
    let y = compressed.yCoords[slice];
    let z0 = compressed.zCoords[v];
    let z1 = compressed.zCoords[v + height];
    let index = 0;

    if (direction === 3) {
        y = compressed.yCoords[slice + 1];
    }

    if (direction === 2) {
        for (index = u; index < u + width; index += 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, compressed.xCoords[index], y, z0);
        }

        for (index = v; index < v + height; index += 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, x1, y, compressed.zCoords[index]);
        }

        for (index = u + width; index > u; index -= 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, compressed.xCoords[index], y, z1);
        }

        for (index = v + height; index > v; index -= 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, x0, y, compressed.zCoords[index]);
        }

        emitVoxelBoundaryFan(positions, pointX, pointY, pointZ);
        return;
    }

    for (index = v; index < v + height; index += 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, x0, y, compressed.zCoords[index]);
    }

    for (index = u; index < u + width; index += 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, compressed.xCoords[index], y, z1);
    }

    for (index = v + height; index > v; index -= 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, x1, y, compressed.zCoords[index]);
    }

    for (index = u + width; index > u; index -= 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, compressed.xCoords[index], y, z0);
    }

    emitVoxelBoundaryFan(positions, pointX, pointY, pointZ);
}

function emitCompressedVoxelZFaceRectangle(positions, compressed, direction, slice, u, v, width, height) {
    let pointX = [];
    let pointY = [];
    let pointZ = [];
    let x0 = compressed.xCoords[u];
    let x1 = compressed.xCoords[u + width];
    let y0 = compressed.yCoords[v];
    let y1 = compressed.yCoords[v + height];
    let z = compressed.zCoords[slice];
    let index = 0;

    if (direction === 5) {
        z = compressed.zCoords[slice + 1];
    }

    if (direction === 4) {
        for (index = v; index < v + height; index += 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, x0, compressed.yCoords[index], z);
        }

        for (index = u; index < u + width; index += 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, compressed.xCoords[index], y1, z);
        }

        for (index = v + height; index > v; index -= 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, x1, compressed.yCoords[index], z);
        }

        for (index = u + width; index > u; index -= 1) {
            pushVoxelBoundaryPoint(pointX, pointY, pointZ, compressed.xCoords[index], y0, z);
        }

        emitVoxelBoundaryFan(positions, pointX, pointY, pointZ);
        return;
    }

    for (index = u; index < u + width; index += 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, compressed.xCoords[index], y0, z);
    }

    for (index = v; index < v + height; index += 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, x1, compressed.yCoords[index], z);
    }

    for (index = u + width; index > u; index -= 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, compressed.xCoords[index], y1, z);
    }

    for (index = v + height; index > v; index -= 1) {
        pushVoxelBoundaryPoint(pointX, pointY, pointZ, x0, compressed.yCoords[index], z);
    }

    emitVoxelBoundaryFan(positions, pointX, pointY, pointZ);
}

function emitShiftedVoxelBlendMesh(occupied, cellCount, cleanBounds, positions, progressFunc) {
    let xIndex = 0;
    let yIndex = 0;
    let zIndex = 0;
    let pattern = 0;
    let localTriangles = null;

    reportMeshProgress(progressFunc, "Emitting shifted voxel junctions", 0.0, 3, 3);

    if (!shiftedVoxelTileTable) {
        shiftedVoxelTileTable = createShiftedVoxelTileTable();
    }

    for (zIndex = 0; zIndex <= cellCount; zIndex += 1) {
        for (yIndex = 0; yIndex <= cellCount; yIndex += 1) {
            for (xIndex = 0; xIndex <= cellCount; xIndex += 1) {
                pattern = shiftedVoxelTilePattern(occupied, cellCount, xIndex, yIndex, zIndex, null);
                localTriangles = shiftedVoxelTileTable[pattern];

                if (localTriangles.length === 0) {
                    continue;
                }

                emitShiftedVoxelTileTableTriangles(positions, cleanBounds, cellCount, xIndex, yIndex, zIndex, localTriangles);
            }
        }

        reportMeshProgress(progressFunc, "Emitting shifted voxel junctions", (zIndex + 1) / (cellCount + 1), 3, 3);
    }
}

function createShiftedVoxelTileWorkspace() {
    return {
        cornerInside: new Uint8Array(8),
        edgeActive: new Uint8Array(12),
        edgeX2: new Float64Array(12),
        edgeY2: new Float64Array(12),
        edgeZ2: new Float64Array(12),
        graphA: new Int8Array(12),
        graphB: new Int8Array(12),
        graphDegree: new Uint8Array(12),
        graphUsed: new Uint8Array(144),
        loopEdges: [],
        loopX2: [],
        loopY2: [],
        loopZ2: [],
        seenCorners: new Uint8Array(8)
    };
}

function createShiftedVoxelTileTable() {
    let table = [];
    let pattern = 0;
    let tile = createShiftedVoxelTileWorkspace();
    let localBounds = {
        minX: 0.0,
        minY: 0.0,
        minZ: 0.0,
        size: 2.0
    };
    let localTriangles = null;

    for (pattern = 0; pattern < 256; pattern += 1) {
        setShiftedVoxelTilePatternBits(tile.cornerInside, pattern);
        localTriangles = [];

        if (pattern !== 0 && pattern !== 255) {
            emitShiftedVoxelBlendTile(localTriangles, localBounds, 1, 0, 0, 0, tile);
        }

        table[pattern] = new Float32Array(localTriangles);
    }

    return table;
}

function setShiftedVoxelTilePatternBits(cornerInside, pattern) {
    let corner = 0;

    for (corner = 0; corner < 8; corner += 1) {
        cornerInside[corner] = 0;

        if (pattern & (1 << corner)) {
            cornerInside[corner] = 1;
        }
    }
}

function shiftedVoxelTilePattern(occupied, cellCount, xIndex, yIndex, zIndex, cornerInside) {
    let corner = 0;
    let voxelX = 0;
    let voxelY = 0;
    let voxelZ = 0;
    let pattern = 0;

    for (corner = 0; corner < 8; corner += 1) {
        voxelX = xIndex + cubeCornerX[corner] - 1;
        voxelY = yIndex + cubeCornerY[corner] - 1;
        voxelZ = zIndex + cubeCornerZ[corner] - 1;

        if (cornerInside) {
            cornerInside[corner] = 0;
        }

        if (voxelCellIsOccupied(occupied, cellCount, voxelX, voxelY, voxelZ)) {
            if (cornerInside) {
                cornerInside[corner] = 1;
            }

            pattern |= 1 << corner;
        }
    }

    return pattern;
}

function emitShiftedVoxelTileTableTriangles(positions, cleanBounds, cellCount, xIndex, yIndex, zIndex, localTriangles) {
    let step = cleanBounds.size / cellCount;
    let halfStep = step * 0.5;
    let baseX2 = 2 * xIndex;
    let baseY2 = 2 * yIndex;
    let baseZ2 = 2 * zIndex;
    let index = 0;

    for (index = 0; index < localTriangles.length; index += 9) {
        pushTriangleCoordinates(
            positions,
            cleanBounds.minX + (baseX2 + localTriangles[index]) * halfStep,
            cleanBounds.minY + (baseY2 + localTriangles[index + 1]) * halfStep,
            cleanBounds.minZ + (baseZ2 + localTriangles[index + 2]) * halfStep,
            cleanBounds.minX + (baseX2 + localTriangles[index + 3]) * halfStep,
            cleanBounds.minY + (baseY2 + localTriangles[index + 4]) * halfStep,
            cleanBounds.minZ + (baseZ2 + localTriangles[index + 5]) * halfStep,
            cleanBounds.minX + (baseX2 + localTriangles[index + 6]) * halfStep,
            cleanBounds.minY + (baseY2 + localTriangles[index + 7]) * halfStep,
            cleanBounds.minZ + (baseZ2 + localTriangles[index + 8]) * halfStep
        );
    }
}

function emitShiftedVoxelBlendTile(positions, cleanBounds, cellCount, xIndex, yIndex, zIndex, tile) {
    resetShiftedVoxelTileWorkspace(tile);
    collectShiftedVoxelTileEdgeVertices(xIndex, yIndex, zIndex, tile);
    connectShiftedVoxelTileFaceSegments(tile);
    emitShiftedVoxelTileLoops(positions, cleanBounds, cellCount, xIndex, yIndex, zIndex, tile);
}

function resetShiftedVoxelTileWorkspace(tile) {
    let index = 0;

    for (index = 0; index < 12; index += 1) {
        tile.edgeActive[index] = 0;
        tile.graphA[index] = -1;
        tile.graphB[index] = -1;
        tile.graphDegree[index] = 0;
    }

    for (index = 0; index < 144; index += 1) {
        tile.graphUsed[index] = 0;
    }
}

function collectShiftedVoxelTileEdgeVertices(xIndex, yIndex, zIndex, tile) {
    let edge = 0;
    let firstCorner = 0;
    let secondCorner = 0;

    for (edge = 0; edge < 12; edge += 1) {
        firstCorner = cubeEdgeA[edge];
        secondCorner = cubeEdgeB[edge];

        if (tile.cornerInside[firstCorner] === tile.cornerInside[secondCorner]) {
            continue;
        }

        tile.edgeActive[edge] = 1;
        tile.edgeX2[edge] = shiftedVoxelCornerX2(xIndex, firstCorner) * 0.5 + shiftedVoxelCornerX2(xIndex, secondCorner) * 0.5;
        tile.edgeY2[edge] = shiftedVoxelCornerY2(yIndex, firstCorner) * 0.5 + shiftedVoxelCornerY2(yIndex, secondCorner) * 0.5;
        tile.edgeZ2[edge] = shiftedVoxelCornerZ2(zIndex, firstCorner) * 0.5 + shiftedVoxelCornerZ2(zIndex, secondCorner) * 0.5;
    }
}

function shiftedVoxelCornerX2(xIndex, corner) {
    return 2 * xIndex + cubeCornerX[corner] * 2 - 1;
}

function shiftedVoxelCornerY2(yIndex, corner) {
    return 2 * yIndex + cubeCornerY[corner] * 2 - 1;
}

function shiftedVoxelCornerZ2(zIndex, corner) {
    return 2 * zIndex + cubeCornerZ[corner] * 2 - 1;
}

function connectShiftedVoxelTileFaceSegments(tile) {
    let face = 0;
    let edgeOffset = 0;
    let crossingSlots = [];
    let crossingCount = 0;

    for (face = 0; face < 6; face += 1) {
        crossingCount = 0;

        for (edgeOffset = 0; edgeOffset < 4; edgeOffset += 1) {
            if (tile.edgeActive[cubeFaceEdges[face * 4 + edgeOffset]]) {
                crossingSlots[crossingCount] = edgeOffset;
                crossingCount += 1;
            }
        }

        if (crossingCount === 2) {
            addShiftedVoxelTileGraphEdge(
                tile,
                cubeFaceEdges[face * 4 + crossingSlots[0]],
                cubeFaceEdges[face * 4 + crossingSlots[1]]
            );
        } else if (crossingCount === 4) {
            connectShiftedVoxelTileAmbiguousFace(tile, face);
        }
    }
}

function connectShiftedVoxelTileAmbiguousFace(tile, face) {
    let cornerOffset = 0;
    let previousOffset = 0;
    let nextOffset = 0;
    let corner = 0;
    let previousCorner = 0;
    let nextCorner = 0;

    for (cornerOffset = 0; cornerOffset < 4; cornerOffset += 1) {
        previousOffset = cornerOffset - 1;
        nextOffset = cornerOffset + 1;

        if (previousOffset < 0) {
            previousOffset = 3;
        }

        if (nextOffset >= 4) {
            nextOffset = 0;
        }

        corner = cubeFaceCorners[face * 4 + cornerOffset];
        previousCorner = cubeFaceCorners[face * 4 + previousOffset];
        nextCorner = cubeFaceCorners[face * 4 + nextOffset];

        if (tile.cornerInside[corner] && !tile.cornerInside[previousCorner] && !tile.cornerInside[nextCorner]) {
            addShiftedVoxelTileGraphEdge(
                tile,
                cubeFaceEdges[face * 4 + previousOffset],
                cubeFaceEdges[face * 4 + cornerOffset]
            );
        }
    }
}

function addShiftedVoxelTileGraphEdge(tile, firstEdge, secondEdge) {
    addShiftedVoxelTileGraphNeighbor(tile, firstEdge, secondEdge);
    addShiftedVoxelTileGraphNeighbor(tile, secondEdge, firstEdge);
}

function addShiftedVoxelTileGraphNeighbor(tile, edge, neighbor) {
    if (tile.graphDegree[edge] === 0) {
        tile.graphA[edge] = neighbor;
        tile.graphDegree[edge] = 1;
    } else if (tile.graphDegree[edge] === 1 && tile.graphA[edge] !== neighbor) {
        tile.graphB[edge] = neighbor;
        tile.graphDegree[edge] = 2;
    }
}

function emitShiftedVoxelTileLoops(positions, cleanBounds, cellCount, xIndex, yIndex, zIndex, tile) {
    let startEdge = 0;
    let slot = 0;
    let neighbor = 0;

    for (startEdge = 0; startEdge < 12; startEdge += 1) {
        for (slot = 0; slot < tile.graphDegree[startEdge]; slot += 1) {
            neighbor = shiftedVoxelTileGraphNeighbor(tile, startEdge, slot);

            if (neighbor < 0 || shiftedVoxelTileGraphEdgeUsed(tile, startEdge, neighbor)) {
                continue;
            }

            traceShiftedVoxelTileLoop(tile, startEdge, neighbor);

            if (tile.loopEdges.length >= 3) {
                emitShiftedVoxelTileLoop(positions, cleanBounds, cellCount, xIndex, yIndex, zIndex, tile);
            }
        }
    }
}

function traceShiftedVoxelTileLoop(tile, startEdge, firstNeighbor) {
    let previousEdge = startEdge;
    let currentEdge = firstNeighbor;
    let nextEdge = 0;
    let guard = 0;

    tile.loopEdges.length = 0;
    tile.loopEdges.push(startEdge);
    markShiftedVoxelTileGraphEdgeUsed(tile, startEdge, firstNeighbor);

    while (currentEdge !== startEdge && guard < 24) {
        tile.loopEdges.push(currentEdge);
        nextEdge = nextShiftedVoxelTileGraphEdge(tile, currentEdge, previousEdge);

        if (nextEdge < 0) {
            tile.loopEdges.length = 0;
            return;
        }

        markShiftedVoxelTileGraphEdgeUsed(tile, currentEdge, nextEdge);
        previousEdge = currentEdge;
        currentEdge = nextEdge;
        guard += 1;
    }

    if (currentEdge !== startEdge) {
        tile.loopEdges.length = 0;
    }
}

function nextShiftedVoxelTileGraphEdge(tile, currentEdge, previousEdge) {
    let slot = 0;
    let neighbor = 0;

    for (slot = 0; slot < tile.graphDegree[currentEdge]; slot += 1) {
        neighbor = shiftedVoxelTileGraphNeighbor(tile, currentEdge, slot);

        if (neighbor !== previousEdge && !shiftedVoxelTileGraphEdgeUsed(tile, currentEdge, neighbor)) {
            return neighbor;
        }
    }

    for (slot = 0; slot < tile.graphDegree[currentEdge]; slot += 1) {
        neighbor = shiftedVoxelTileGraphNeighbor(tile, currentEdge, slot);

        if (!shiftedVoxelTileGraphEdgeUsed(tile, currentEdge, neighbor)) {
            return neighbor;
        }
    }

    return -1;
}

function shiftedVoxelTileGraphNeighbor(tile, edge, slot) {
    if (slot === 0) {
        return tile.graphA[edge];
    }

    return tile.graphB[edge];
}

function shiftedVoxelTileGraphEdgeUsed(tile, firstEdge, secondEdge) {
    return tile.graphUsed[firstEdge * 12 + secondEdge] !== 0;
}

function markShiftedVoxelTileGraphEdgeUsed(tile, firstEdge, secondEdge) {
    tile.graphUsed[firstEdge * 12 + secondEdge] = 1;
    tile.graphUsed[secondEdge * 12 + firstEdge] = 1;
}

function emitShiftedVoxelTileLoop(positions, cleanBounds, cellCount, xIndex, yIndex, zIndex, tile) {
    let edgeIndex = 0;
    let edge = 0;
    let nextIndex = 0;
    let centerX2 = 0.0;
    let centerY2 = 0.0;
    let centerZ2 = 0.0;
    let reverse = false;
    let desired = null;
    let normal = null;

    tile.loopX2.length = 0;
    tile.loopY2.length = 0;
    tile.loopZ2.length = 0;

    for (edgeIndex = 0; edgeIndex < tile.loopEdges.length; edgeIndex += 1) {
        edge = tile.loopEdges[edgeIndex];
        tile.loopX2.push(tile.edgeX2[edge]);
        tile.loopY2.push(tile.edgeY2[edge]);
        tile.loopZ2.push(tile.edgeZ2[edge]);
        centerX2 += tile.edgeX2[edge];
        centerY2 += tile.edgeY2[edge];
        centerZ2 += tile.edgeZ2[edge];
    }

    centerX2 /= tile.loopEdges.length;
    centerY2 /= tile.loopEdges.length;
    centerZ2 /= tile.loopEdges.length;
    desired = shiftedVoxelTileLoopDesiredNormal(tile, xIndex, yIndex, zIndex);
    normal = shiftedVoxelTileLoopNormal(tile);
    reverse = normal.x * desired.x + normal.y * desired.y + normal.z * desired.z < 0.0;

    if (tile.loopEdges.length === 3) {
        emitShiftedVoxelTileLoopTriangle(positions, cleanBounds, cellCount, tile, 0, 1, 2, reverse);
        return;
    }

    for (edgeIndex = 0; edgeIndex < tile.loopEdges.length; edgeIndex += 1) {
        nextIndex = edgeIndex + 1;

        if (nextIndex >= tile.loopEdges.length) {
            nextIndex = 0;
        }

        emitShiftedVoxelTileLoopFanTriangle(positions, cleanBounds, cellCount, tile, centerX2, centerY2, centerZ2, edgeIndex, nextIndex, reverse);
    }
}

function shiftedVoxelTileLoopDesiredNormal(tile, xIndex, yIndex, zIndex) {
    let loopIndex = 0;
    let cornerOffset = 0;
    let edge = 0;
    let corner = 0;
    let insideX = 0.0;
    let insideY = 0.0;
    let insideZ = 0.0;
    let outsideX = 0.0;
    let outsideY = 0.0;
    let outsideZ = 0.0;
    let insideCount = 0;
    let outsideCount = 0;

    for (corner = 0; corner < 8; corner += 1) {
        tile.seenCorners[corner] = 0;
    }

    for (loopIndex = 0; loopIndex < tile.loopEdges.length; loopIndex += 1) {
        edge = tile.loopEdges[loopIndex];

        for (cornerOffset = 0; cornerOffset < 2; cornerOffset += 1) {
            corner = cubeEdgeA[edge];

            if (cornerOffset === 1) {
                corner = cubeEdgeB[edge];
            }

            if (tile.seenCorners[corner]) {
                continue;
            }

            tile.seenCorners[corner] = 1;

            if (tile.cornerInside[corner]) {
                insideX += shiftedVoxelCornerX2(xIndex, corner);
                insideY += shiftedVoxelCornerY2(yIndex, corner);
                insideZ += shiftedVoxelCornerZ2(zIndex, corner);
                insideCount += 1;
            } else {
                outsideX += shiftedVoxelCornerX2(xIndex, corner);
                outsideY += shiftedVoxelCornerY2(yIndex, corner);
                outsideZ += shiftedVoxelCornerZ2(zIndex, corner);
                outsideCount += 1;
            }
        }
    }

    return {
        x: outsideX / outsideCount - insideX / insideCount,
        y: outsideY / outsideCount - insideY / insideCount,
        z: outsideZ / outsideCount - insideZ / insideCount
    };
}

function shiftedVoxelTileLoopNormal(tile) {
    let index = 0;
    let nextIndex = 0;
    let normalX = 0.0;
    let normalY = 0.0;
    let normalZ = 0.0;
    let ax = 0.0;
    let ay = 0.0;
    let az = 0.0;
    let bx = 0.0;
    let by = 0.0;
    let bz = 0.0;

    for (index = 0; index < tile.loopEdges.length; index += 1) {
        nextIndex = index + 1;

        if (nextIndex >= tile.loopEdges.length) {
            nextIndex = 0;
        }

        ax = tile.loopX2[index];
        ay = tile.loopY2[index];
        az = tile.loopZ2[index];
        bx = tile.loopX2[nextIndex];
        by = tile.loopY2[nextIndex];
        bz = tile.loopZ2[nextIndex];
        normalX += (ay - by) * (az + bz);
        normalY += (az - bz) * (ax + bx);
        normalZ += (ax - bx) * (ay + by);
    }

    return {
        x: normalX,
        y: normalY,
        z: normalZ
    };
}

function emitShiftedVoxelTileLoopTriangle(positions, cleanBounds, cellCount, tile, firstIndex, secondIndex, thirdIndex, reverse) {
    if (reverse) {
        pushShiftedVoxelTileTriangle(
            positions,
            cleanBounds,
            cellCount,
            tile.loopX2[firstIndex],
            tile.loopY2[firstIndex],
            tile.loopZ2[firstIndex],
            tile.loopX2[thirdIndex],
            tile.loopY2[thirdIndex],
            tile.loopZ2[thirdIndex],
            tile.loopX2[secondIndex],
            tile.loopY2[secondIndex],
            tile.loopZ2[secondIndex]
        );
        return;
    }

    pushShiftedVoxelTileTriangle(
        positions,
        cleanBounds,
        cellCount,
        tile.loopX2[firstIndex],
        tile.loopY2[firstIndex],
        tile.loopZ2[firstIndex],
        tile.loopX2[secondIndex],
        tile.loopY2[secondIndex],
        tile.loopZ2[secondIndex],
        tile.loopX2[thirdIndex],
        tile.loopY2[thirdIndex],
        tile.loopZ2[thirdIndex]
    );
}

function emitShiftedVoxelTileLoopFanTriangle(positions, cleanBounds, cellCount, tile, centerX2, centerY2, centerZ2, firstIndex, secondIndex, reverse) {
    if (reverse) {
        pushShiftedVoxelTileTriangle(
            positions,
            cleanBounds,
            cellCount,
            centerX2,
            centerY2,
            centerZ2,
            tile.loopX2[secondIndex],
            tile.loopY2[secondIndex],
            tile.loopZ2[secondIndex],
            tile.loopX2[firstIndex],
            tile.loopY2[firstIndex],
            tile.loopZ2[firstIndex]
        );
        return;
    }

    pushShiftedVoxelTileTriangle(
        positions,
        cleanBounds,
        cellCount,
        centerX2,
        centerY2,
        centerZ2,
        tile.loopX2[firstIndex],
        tile.loopY2[firstIndex],
        tile.loopZ2[firstIndex],
        tile.loopX2[secondIndex],
        tile.loopY2[secondIndex],
        tile.loopZ2[secondIndex]
    );
}

function pushShiftedVoxelTileTriangle(positions, cleanBounds, cellCount, ax2, ay2, az2, bx2, by2, bz2, cx2Value, cy2Value, cz2Value) {
    let step = cleanBounds.size / cellCount;

    pushTriangleCoordinates(
        positions,
        cleanBounds.minX + ax2 * step * 0.5,
        cleanBounds.minY + ay2 * step * 0.5,
        cleanBounds.minZ + az2 * step * 0.5,
        cleanBounds.minX + bx2 * step * 0.5,
        cleanBounds.minY + by2 * step * 0.5,
        cleanBounds.minZ + bz2 * step * 0.5,
        cleanBounds.minX + cx2Value * step * 0.5,
        cleanBounds.minY + cy2Value * step * 0.5,
        cleanBounds.minZ + cz2Value * step * 0.5
    );
}

function voxelCellIsOccupied(occupied, cellCount, xIndex, yIndex, zIndex) {
    if (xIndex < 0 || yIndex < 0 || zIndex < 0 || xIndex >= cellCount || yIndex >= cellCount || zIndex >= cellCount) {
        return false;
    }

    return occupied[cellIndex(xIndex, yIndex, zIndex, cellCount)] !== 0;
}

function pushTriangleCoordinates(positions, ax, ay, az, bx, by, bz, cx, cy, cz) {
    pushVertex(positions, ax, ay, az);
    pushVertex(positions, bx, by, bz);
    pushVertex(positions, cx, cy, cz);
}

function pushVertex(positions, x, y, z) {
    positions.push(x);
    positions.push(y);
    positions.push(z);
}

function projectPointToSurface(sampleFunc, x, y, z, step) {
    let px = x;
    let py = y;
    let pz = z;
    let iteration = 0;
    let distanceValue = 0.0;
    let normal = null;
    let move = 0.0;
    let maxMove = step * 0.75;

    for (iteration = 0; iteration < 6; iteration += 1) {
        distanceValue = sampleFunc(px, py, pz);

        if (Math.abs(distanceValue) <= step * 0.0005) {
            break;
        }

        normal = estimateGradient(sampleFunc, px, py, pz, step * 0.15);
        move = Math.min(Math.max(distanceValue, -maxMove), maxMove);
        px -= normal.x * move;
        py -= normal.y * move;
        pz -= normal.z * move;
    }

    return {
        x: px,
        y: py,
        z: pz
    };
}

function buildContourFitMesh(sampleFunc, cellCount, cleanBounds, method, methodLabel, minimumFeatureSize, subdivisions, progressFunc) {
    let progressStepCount = 8;
    let step = cleanBounds.size / cellCount;
    let gridSize = cellCount + 1;
    let values = new Float32Array(gridSize * gridSize * gridSize);
    let cellEdgeVertices = new Int32Array(cellCount * cellCount * cellCount * 12);
    let vertexX = [];
    let vertexY = [];
    let vertexZ = [];
    let positions = [];
    let refinedPositions = [];
    let xIndex = 0;
    let yIndex = 0;
    let zIndex = 0;
    let cellOffset = 0;
    let cornerValues = new Float32Array(8);
    let contourWorkspace = createContourCellWorkspace();

    cellEdgeVertices.fill(-1);
    sampleGridValues(values, sampleFunc, cellCount, cleanBounds, progressFunc, 0.0, progressStepCount);

    for (zIndex = 0; zIndex < cellCount; zIndex += 1) {
        for (yIndex = 0; yIndex < cellCount; yIndex += 1) {
            for (xIndex = 0; xIndex < cellCount; xIndex += 1) {
                readGridCellValues(values, cornerValues, gridSize, xIndex, yIndex, zIndex);

                if (cellHasSurface(cornerValues)) {
                    cellOffset = cellIndex(xIndex, yIndex, zIndex, cellCount);
                    computeContourCellVertices(
                        sampleFunc,
                        cleanBounds.minX + xIndex * step,
                        cleanBounds.minY + yIndex * step,
                        cleanBounds.minZ + zIndex * step,
                        step,
                        cornerValues,
                        cellEdgeVertices,
                        cellOffset,
                        vertexX,
                        vertexY,
                        vertexZ,
                        contourWorkspace
                    );
                }
            }
        }

        reportMeshProgress(progressFunc, "Solving fitted vertices", (zIndex + 1) / cellCount, 2, progressStepCount);
    }

    emitContourFaces(values, cellEdgeVertices, vertexX, vertexY, vertexZ, positions, sampleFunc, cellCount, gridSize, step, progressFunc, progressStepCount);
    reportMeshProgress(progressFunc, "Refining contour mesh", 0.0, 8, progressStepCount);
    refinedPositions = refineContourMeshTriangles(positions, sampleFunc, step, minimumFeatureSize);
    refinedPositions = cleanContourMeshTopology(refinedPositions, step);
    refinedPositions = repairContourMeshSeams(refinedPositions, sampleFunc, step);

    reportMeshProgress(progressFunc, methodLabel, 1.0, 8, progressStepCount);

    return {
        positions: new Float32Array(refinedPositions),
        triangleCount: refinedPositions.length / 9,
        resolution: cellCount,
        cellSize: step,
        minimumFeatureSize: minimumFeatureSize,
        subdivisions: subdivisions,
        bound: cleanBounds.boundValue,
        padding: cleanBounds.padding,
        minX: cleanBounds.minX,
        minY: cleanBounds.minY,
        minZ: cleanBounds.minZ,
        maxX: cleanBounds.minX + cleanBounds.size,
        maxY: cleanBounds.minY + cleanBounds.size,
        maxZ: cleanBounds.minZ + cleanBounds.size,
        method: method,
        methodLabel: methodLabel
    };
}

function buildMarchingTetrahedraMesh(sampleFunc, cellCount, cleanBounds, method, methodLabel, minimumFeatureSize, subdivisions, progressFunc) {
    let step = cleanBounds.size / cellCount;
    let gridSize = cellCount + 1;
    let values = new Float32Array(gridSize * gridSize * gridSize);
    let vertexX = [];
    let vertexY = [];
    let vertexZ = [];
    let positions = [];
    let edgeVertexMap = new Map();
    let interpolationClamp = marchingTetraInterpolationClamp(cleanBounds, step);

    sampleGridValues(values, sampleFunc, cellCount, cleanBounds, progressFunc, 0.0, 2);
    emitMarchingTetrahedraMesh(values, edgeVertexMap, vertexX, vertexY, vertexZ, positions, sampleFunc, cellCount, cleanBounds, gridSize, step, interpolationClamp, progressFunc);
    reportMeshProgress(progressFunc, methodLabel, 1.0, 2, 2);

    return {
        positions: new Float32Array(positions),
        triangleCount: positions.length / 9,
        resolution: cellCount,
        cellSize: step,
        minimumFeatureSize: minimumFeatureSize,
        subdivisions: subdivisions,
        bound: cleanBounds.boundValue,
        padding: cleanBounds.padding,
        minX: cleanBounds.minX,
        minY: cleanBounds.minY,
        minZ: cleanBounds.minZ,
        maxX: cleanBounds.minX + cleanBounds.size,
        maxY: cleanBounds.minY + cleanBounds.size,
        maxZ: cleanBounds.minZ + cleanBounds.size,
        method: method,
        methodLabel: methodLabel
    };
}

function contourWeldToleranceFromBounds(cleanBounds) {
    let maxAbs = 1.0;
    let value = 0.0;

    value = Math.abs(cleanBounds.minX);
    if (value > maxAbs) {
        maxAbs = value;
    }

    value = Math.abs(cleanBounds.minY);
    if (value > maxAbs) {
        maxAbs = value;
    }

    value = Math.abs(cleanBounds.minZ);
    if (value > maxAbs) {
        maxAbs = value;
    }

    value = Math.abs(cleanBounds.minX + cleanBounds.size);
    if (value > maxAbs) {
        maxAbs = value;
    }

    value = Math.abs(cleanBounds.minY + cleanBounds.size);
    if (value > maxAbs) {
        maxAbs = value;
    }

    value = Math.abs(cleanBounds.minZ + cleanBounds.size);
    if (value > maxAbs) {
        maxAbs = value;
    }

    return Math.max(0.00005, maxAbs * 0.000001);
}

function emitMarchingTetrahedraMesh(values, edgeVertexMap, vertexX, vertexY, vertexZ, positions, sampleFunc, cellCount, cleanBounds, gridSize, step, interpolationClamp, progressFunc) {
    let cornerValues = new Float32Array(8);
    let cornerGridIndices = new Int32Array(8);
    let tetraWorkspace = createMarchingTetraWorkspace();
    let xIndex = 0;
    let yIndex = 0;
    let zIndex = 0;
    let cornerIndex = 0;
    let tetraIndex = 0;
    let tetraTable = marchingTetraEvenCorners;

    reportMeshProgress(progressFunc, "Building tetrahedra", 0.0, 2, 2);

    for (zIndex = 0; zIndex < cellCount; zIndex += 1) {
        for (yIndex = 0; yIndex < cellCount; yIndex += 1) {
            for (xIndex = 0; xIndex < cellCount; xIndex += 1) {
                readGridCellValues(values, cornerValues, gridSize, xIndex, yIndex, zIndex);

                if (!cellHasSurface(cornerValues)) {
                    continue;
                }

                for (cornerIndex = 0; cornerIndex < 8; cornerIndex += 1) {
                    cornerGridIndices[cornerIndex] = gridIndex(
                        xIndex + cubeCornerX[cornerIndex],
                        yIndex + cubeCornerY[cornerIndex],
                        zIndex + cubeCornerZ[cornerIndex],
                        gridSize
                    );
                }

                if ((xIndex + yIndex + zIndex) % 2 === 0) {
                    tetraTable = marchingTetraEvenCorners;
                } else {
                    tetraTable = marchingTetraOddCorners;
                }

                for (tetraIndex = 0; tetraIndex < 5; tetraIndex += 1) {
                    emitMarchingTetrahedron(
                        tetraTable,
                        cornerValues,
                        cornerGridIndices,
                        edgeVertexMap,
                        vertexX,
                        vertexY,
                        vertexZ,
                        positions,
                        sampleFunc,
                        cleanBounds,
                        gridSize,
                        step,
                        interpolationClamp,
                        xIndex,
                        yIndex,
                        zIndex,
                        tetraIndex,
                        tetraWorkspace
                    );
                }
            }
        }

        reportMeshProgress(progressFunc, "Building tetrahedra", (zIndex + 1) / cellCount, 2, 2);
    }
}

function createMarchingTetraWorkspace() {
    return {
        corners: new Int8Array(4),
        insideIndices: new Int8Array(4),
        outsideIndices: new Int8Array(4)
    };
}

function emitMarchingTetrahedron(tetraTable, cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, positions, sampleFunc, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex, tetraIndex, workspace) {
    let base = tetraIndex * 4;
    let corners = workspace.corners;
    let insideIndices = workspace.insideIndices;
    let outsideIndices = workspace.outsideIndices;
    let insideCount = 0;
    let outsideCount = 0;
    let index = 0;
    let vertexA = -1;
    let vertexB = -1;
    let vertexC = -1;
    let vertexD = -1;

    for (index = 0; index < 4; index += 1) {
        corners[index] = tetraTable[base + index];

        if (cornerValues[corners[index]] < 0.0) {
            insideIndices[insideCount] = index;
            insideCount += 1;
        } else {
            outsideIndices[outsideCount] = index;
            outsideCount += 1;
        }
    }

    if (insideCount === 0 || insideCount === 4) {
        return;
    }

    if (insideCount === 1) {
        vertexA = marchingTetraEdgeVertex(corners, insideIndices[0], outsideIndices[0], cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex);
        vertexB = marchingTetraEdgeVertex(corners, insideIndices[0], outsideIndices[1], cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex);
        vertexC = marchingTetraEdgeVertex(corners, insideIndices[0], outsideIndices[2], cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex);
        addMarchingTetraTriangle(vertexX, vertexY, vertexZ, positions, sampleFunc, step, vertexA, vertexB, vertexC);
        return;
    }

    if (insideCount === 3) {
        vertexA = marchingTetraEdgeVertex(corners, outsideIndices[0], insideIndices[0], cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex);
        vertexB = marchingTetraEdgeVertex(corners, outsideIndices[0], insideIndices[1], cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex);
        vertexC = marchingTetraEdgeVertex(corners, outsideIndices[0], insideIndices[2], cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex);
        addMarchingTetraTriangle(vertexX, vertexY, vertexZ, positions, sampleFunc, step, vertexA, vertexC, vertexB);
        return;
    }

    vertexA = marchingTetraEdgeVertex(corners, insideIndices[0], outsideIndices[0], cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex);
    vertexB = marchingTetraEdgeVertex(corners, insideIndices[1], outsideIndices[0], cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex);
    vertexC = marchingTetraEdgeVertex(corners, insideIndices[1], outsideIndices[1], cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex);
    vertexD = marchingTetraEdgeVertex(corners, insideIndices[0], outsideIndices[1], cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex);
    addMarchingTetraTriangle(vertexX, vertexY, vertexZ, positions, sampleFunc, step, vertexA, vertexB, vertexC);
    addMarchingTetraTriangle(vertexX, vertexY, vertexZ, positions, sampleFunc, step, vertexA, vertexC, vertexD);
}

function marchingTetraEdgeVertex(corners, firstIndex, secondIndex, cornerValues, cornerGridIndices, edgeVertexMap, vertexX, vertexY, vertexZ, cleanBounds, gridSize, step, interpolationClamp, xIndex, yIndex, zIndex) {
    let firstCorner = corners[firstIndex];
    let secondCorner = corners[secondIndex];
    let firstGridIndex = cornerGridIndices[firstCorner];
    let secondGridIndex = cornerGridIndices[secondCorner];
    let key = marchingTetraEdgeKey(firstGridIndex, secondGridIndex, gridSize);
    let vertexIndex = edgeVertexMap.get(key);
    let t = 0.5;
    let ax = 0.0;
    let ay = 0.0;
    let az = 0.0;
    let bx = 0.0;
    let by = 0.0;
    let bz = 0.0;

    if (Number.isFinite(vertexIndex)) {
        return vertexIndex;
    }

    t = clampMarchingTetraInterpolation(edgeInterpolation(cornerValues[firstCorner], cornerValues[secondCorner]), interpolationClamp);
    ax = cleanBounds.minX + (xIndex + cubeCornerX[firstCorner]) * step;
    ay = cleanBounds.minY + (yIndex + cubeCornerY[firstCorner]) * step;
    az = cleanBounds.minZ + (zIndex + cubeCornerZ[firstCorner]) * step;
    bx = cleanBounds.minX + (xIndex + cubeCornerX[secondCorner]) * step;
    by = cleanBounds.minY + (yIndex + cubeCornerY[secondCorner]) * step;
    bz = cleanBounds.minZ + (zIndex + cubeCornerZ[secondCorner]) * step;

    vertexIndex = vertexX.length;
    vertexX.push(ax + (bx - ax) * t);
    vertexY.push(ay + (by - ay) * t);
    vertexZ.push(az + (bz - az) * t);
    edgeVertexMap.set(key, vertexIndex);

    return vertexIndex;
}

function marchingTetraInterpolationClamp(cleanBounds, step) {
    let weldTolerance = 0.00005;
    let clampValue = 0.0;

    weldTolerance = contourWeldToleranceFromBounds(cleanBounds);

    if (!Number.isFinite(step) || step <= 0.0) {
        return 0.5;
    }

    clampValue = 100.0 * Math.SQRT2 * weldTolerance / step;

    if (!Number.isFinite(clampValue) || clampValue < 0.0) {
        return 0.0;
    }

    if (clampValue > 0.5) {
        return 0.5;
    }

    return clampValue;
}

function clampMarchingTetraInterpolation(value, clampValue) {
    let minimumValue = clampValue;
    let maximumValue = 1.0 - clampValue;

    if (value < minimumValue) {
        return minimumValue;
    }

    if (value > maximumValue) {
        return maximumValue;
    }

    return value;
}

function marchingTetraEdgeKey(firstGridIndex, secondGridIndex, gridSize) {
    let first = firstGridIndex;
    let second = secondGridIndex;
    let gridPointCount = gridSize * gridSize * gridSize;

    if (second < first) {
        first = secondGridIndex;
        second = firstGridIndex;
    }

    return first * gridPointCount + second;
}

function addMarchingTetraTriangle(vertexX, vertexY, vertexZ, positions, sampleFunc, step, a, b, c) {
    let ax = 0.0;
    let ay = 0.0;
    let az = 0.0;
    let bx = 0.0;
    let by = 0.0;
    let bz = 0.0;
    let cxValue = 0.0;
    let cyValue = 0.0;
    let czValue = 0.0;

    if (a === b || b === c || c === a) {
        return;
    }

    ax = vertexX[a];
    ay = vertexY[a];
    az = vertexZ[a];
    bx = vertexX[b];
    by = vertexY[b];
    bz = vertexZ[b];
    cxValue = vertexX[c];
    cyValue = vertexY[c];
    czValue = vertexZ[c];

    if (marchingTetraTriangleIsCollapsed(ax, ay, az, bx, by, bz, cxValue, cyValue, czValue)) {
        return;
    }

    addMarchingTetraTriangleCoordinates(positions, sampleFunc, step, ax, ay, az, bx, by, bz, cxValue, cyValue, czValue);
}

function marchingTetraTriangleIsCollapsed(ax, ay, az, bx, by, bz, cx, cy, cz) {
    return distanceBetweenPoints(ax, ay, az, bx, by, bz) <= 0.0
        || distanceBetweenPoints(bx, by, bz, cx, cy, cz) <= 0.0
        || distanceBetweenPoints(cx, cy, cz, ax, ay, az) <= 0.0;
}

function addMarchingTetraTriangleCoordinates(positions, sampleFunc, step, ax, ay, az, bx, by, bz, cx, cy, cz) {
    let ux = bx - ax;
    let uy = by - ay;
    let uz = bz - az;
    let vx = cx - ax;
    let vy = cy - ay;
    let vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    let normalLength = Math.hypot(nx, ny, nz);
    let centerX = (ax + bx + cx) / 3.0;
    let centerY = (ay + by + cy) / 3.0;
    let centerZ = (az + bz + cz) / 3.0;
    let probe = 0.0;

    if (normalLength <= 0.0) {
        return;
    }

    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;
    probe = sampleFunc(centerX + nx * step * 0.20, centerY + ny * step * 0.20, centerZ + nz * step * 0.20);

    if (probe < 0.0) {
        pushVertex(positions, ax, ay, az);
        pushVertex(positions, cx, cy, cz);
        pushVertex(positions, bx, by, bz);
        return;
    }

    pushVertex(positions, ax, ay, az);
    pushVertex(positions, bx, by, bz);
    pushVertex(positions, cx, cy, cz);
}

function sampleGridValues(values, sampleFunc, cellCount, cleanBounds, progressFunc, valueOffset, stepCount) {
    let gridSize = cellCount + 1;
    let step = cleanBounds.size / cellCount;
    let xIndex = 0;
    let yIndex = 0;
    let zIndex = 0;
    let x = 0.0;
    let y = 0.0;
    let z = 0.0;
    let offset = 0.0;
    let progressStepCount = 4;

    if (Number.isFinite(valueOffset)) {
        offset = valueOffset;
    }

    if (Number.isFinite(stepCount)) {
        progressStepCount = stepCount;
    }

    reportMeshProgress(progressFunc, "Sampling grid", 0.0, 1, progressStepCount);

    for (zIndex = 0; zIndex < gridSize; zIndex += 1) {
        z = cleanBounds.minZ + zIndex * step;

        for (yIndex = 0; yIndex < gridSize; yIndex += 1) {
            y = cleanBounds.minY + yIndex * step;

            for (xIndex = 0; xIndex < gridSize; xIndex += 1) {
                x = cleanBounds.minX + xIndex * step;
                values[gridIndex(xIndex, yIndex, zIndex, gridSize)] = sampleFunc(x, y, z) + offset;
            }
        }

        reportMeshProgress(progressFunc, "Sampling grid", (zIndex + 1) / gridSize, 1, progressStepCount);
    }
}

function readGridCellValues(values, cornerValues, gridSize, xIndex, yIndex, zIndex) {
    let index = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;

    for (index = 0; index < 8; index += 1) {
        sx = xIndex + cubeCornerX[index];
        sy = yIndex + cubeCornerY[index];
        sz = zIndex + cubeCornerZ[index];
        cornerValues[index] = values[gridIndex(sx, sy, sz, gridSize)];
    }
}

function emitContourFaces(values, cellEdgeVertices, vertexX, vertexY, vertexZ, positions, sampleFunc, cellCount, gridSize, step, progressFunc, progressStepCount) {
    let candidateGroups = [];
    let candidateVertexStore = createContourVertexStore();

    emitContourFacesForAxis(values, cellEdgeVertices, vertexX, vertexY, vertexZ, candidateGroups, candidateVertexStore, sampleFunc, cellCount, gridSize, step, progressFunc, 0, 3, progressStepCount);
    emitContourFacesForAxis(values, cellEdgeVertices, vertexX, vertexY, vertexZ, candidateGroups, candidateVertexStore, sampleFunc, cellCount, gridSize, step, progressFunc, 1, 4, progressStepCount);
    emitContourFacesForAxis(values, cellEdgeVertices, vertexX, vertexY, vertexZ, candidateGroups, candidateVertexStore, sampleFunc, cellCount, gridSize, step, progressFunc, 2, 5, progressStepCount);
    emitSelectedContourFaceCandidates(candidateGroups, positions, sampleFunc, step, progressFunc, progressStepCount);
}

function emitContourFacesForAxis(values, cellEdgeVertices, vertexX, vertexY, vertexZ, candidateGroups, candidateVertexStore, sampleFunc, cellCount, gridSize, step, progressFunc, axis, progressStepIndex, progressStepCount) {
    let xStart = 1;
    let yStart = 1;
    let zStart = 1;
    let xIndex = 1;
    let yIndex = 1;
    let zIndex = 1;
    let a = 0.0;
    let b = 0.0;

    if (axis === 0) {
        xStart = 0;
    }

    if (axis === 1) {
        yStart = 0;
    }

    if (axis === 2) {
        zStart = 0;
    }

    reportMeshProgress(progressFunc, "Building contour faces", 0.0, progressStepIndex, progressStepCount);

    for (zIndex = zStart; zIndex < cellCount; zIndex += 1) {
        for (yIndex = yStart; yIndex < cellCount; yIndex += 1) {
            for (xIndex = xStart; xIndex < cellCount; xIndex += 1) {
                a = values[gridIndex(xIndex, yIndex, zIndex, gridSize)];
                b = contourFaceAxisNeighborValue(values, gridSize, axis, xIndex, yIndex, zIndex);

                if (valuesCross(a, b)) {
                    addContourAxisQuadCandidate(cellEdgeVertices, vertexX, vertexY, vertexZ, candidateGroups, candidateVertexStore, sampleFunc, step, cellCount, axis, xIndex, yIndex, zIndex);
                }
            }
        }

        reportMeshProgress(progressFunc, "Building contour faces", (zIndex + 1) / cellCount, progressStepIndex, progressStepCount);
    }
}

function contourFaceAxisNeighborValue(values, gridSize, axis, xIndex, yIndex, zIndex) {
    if (axis === 0) {
        return values[gridIndex(xIndex + 1, yIndex, zIndex, gridSize)];
    }

    if (axis === 1) {
        return values[gridIndex(xIndex, yIndex + 1, zIndex, gridSize)];
    }

    return values[gridIndex(xIndex, yIndex, zIndex + 1, gridSize)];
}

function addContourAxisQuadCandidate(cellEdgeVertices, vertexX, vertexY, vertexZ, candidateGroups, candidateVertexStore, sampleFunc, step, cellCount, axis, xIndex, yIndex, zIndex) {
    if (axis === 0) {
        addContourQuadCandidate(
            cellEdgeVertices,
            vertexX,
            vertexY,
            vertexZ,
            candidateGroups,
            candidateVertexStore,
            sampleFunc,
            step,
            cellIndex(xIndex, yIndex - 1, zIndex - 1, cellCount),
            6,
            cellIndex(xIndex, yIndex, zIndex - 1, cellCount),
            4,
            cellIndex(xIndex, yIndex, zIndex, cellCount),
            0,
            cellIndex(xIndex, yIndex - 1, zIndex, cellCount),
            2
        );
        return;
    }

    if (axis === 1) {
        addContourQuadCandidate(
            cellEdgeVertices,
            vertexX,
            vertexY,
            vertexZ,
            candidateGroups,
            candidateVertexStore,
            sampleFunc,
            step,
            cellIndex(xIndex - 1, yIndex, zIndex - 1, cellCount),
            5,
            cellIndex(xIndex, yIndex, zIndex - 1, cellCount),
            7,
            cellIndex(xIndex, yIndex, zIndex, cellCount),
            3,
            cellIndex(xIndex - 1, yIndex, zIndex, cellCount),
            1
        );
        return;
    }

    addContourQuadCandidate(
        cellEdgeVertices,
        vertexX,
        vertexY,
        vertexZ,
        candidateGroups,
        candidateVertexStore,
        sampleFunc,
        step,
        cellIndex(xIndex - 1, yIndex - 1, zIndex, cellCount),
        10,
        cellIndex(xIndex, yIndex - 1, zIndex, cellCount),
        11,
        cellIndex(xIndex, yIndex, zIndex, cellCount),
        8,
        cellIndex(xIndex - 1, yIndex, zIndex, cellCount),
        9
    );
}

function addContourQuadCandidate(cellEdgeVertices, vertexX, vertexY, vertexZ, candidateGroups, candidateVertexStore, sampleFunc, step, c0, e0, c1, e1, c2, e2, c3, e3) {
    let v0 = cellEdgeVertices[c0 * 12 + e0];
    let v1 = cellEdgeVertices[c1 * 12 + e1];
    let v2 = cellEdgeVertices[c2 * 12 + e2];
    let v3 = cellEdgeVertices[c3 * 12 + e3];
    let group = null;
    let splitA0 = 0.0;
    let splitA1 = 0.0;
    let splitB0 = 0.0;
    let splitB1 = 0.0;
    let splitAMax = 0.0;
    let splitBMax = 0.0;

    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) {
        return;
    }

    splitA0 = triangleCenterErrorByIndex(sampleFunc, vertexX, vertexY, vertexZ, v0, v1, v2);
    splitA1 = triangleCenterErrorByIndex(sampleFunc, vertexX, vertexY, vertexZ, v0, v2, v3);
    splitB0 = triangleCenterErrorByIndex(sampleFunc, vertexX, vertexY, vertexZ, v0, v1, v3);
    splitB1 = triangleCenterErrorByIndex(sampleFunc, vertexX, vertexY, vertexZ, v1, v2, v3);
    splitAMax = splitA0;
    splitBMax = splitB0;
    group = {
        variants: []
    };

    if (splitA1 > splitAMax) {
        splitAMax = splitA1;
    }

    if (splitB1 > splitBMax) {
        splitBMax = splitB1;
    }

    if (splitAMax > step * 0.05 && splitBMax > step * 0.05) {
        addContourCenterFanCandidateByIndex(vertexX, vertexY, vertexZ, group, candidateVertexStore, sampleFunc, step, v0, v1, v2, v3);
    }

    addContourTrianglePairCandidateByIndex(vertexX, vertexY, vertexZ, group, candidateVertexStore, sampleFunc, step, v0, v1, v2, v0, v2, v3);
    addContourTrianglePairCandidateByIndex(vertexX, vertexY, vertexZ, group, candidateVertexStore, sampleFunc, step, v0, v1, v3, v1, v2, v3);

    if (group.variants.length > 0) {
        candidateGroups.push(group);
    }
}

function triangleCenterErrorByIndex(sampleFunc, vertexX, vertexY, vertexZ, a, b, c) {
    return triangleCenterError(
        sampleFunc,
        vertexX[a],
        vertexY[a],
        vertexZ[a],
        vertexX[b],
        vertexY[b],
        vertexZ[b],
        vertexX[c],
        vertexY[c],
        vertexZ[c]
    );
}

function addContourTrianglePairCandidateByIndex(vertexX, vertexY, vertexZ, group, candidateVertexStore, sampleFunc, step, a0, b0, c0, a1, b1, c1) {
    let triangles = [];

    addContourTriangleCandidateByIndex(vertexX, vertexY, vertexZ, triangles, a0, b0, c0);
    addContourTriangleCandidateByIndex(vertexX, vertexY, vertexZ, triangles, a1, b1, c1);
    addContourFaceCandidate(group, triangles, candidateVertexStore, sampleFunc, step);
}

function addContourCenterFanCandidateByIndex(vertexX, vertexY, vertexZ, group, candidateVertexStore, sampleFunc, step, a, b, c, d) {
    let center = projectPointToSurface(
        sampleFunc,
        (vertexX[a] + vertexX[b] + vertexX[c] + vertexX[d]) * 0.25,
        (vertexY[a] + vertexY[b] + vertexY[c] + vertexY[d]) * 0.25,
        (vertexZ[a] + vertexZ[b] + vertexZ[c] + vertexZ[d]) * 0.25,
        step
    );
    let triangles = [];

    addContourTriangleCandidateByCoordinates(
        triangles,
        vertexX[a],
        vertexY[a],
        vertexZ[a],
        vertexX[b],
        vertexY[b],
        vertexZ[b],
        center.x,
        center.y,
        center.z
    );
    addContourTriangleCandidateByCoordinates(
        triangles,
        vertexX[b],
        vertexY[b],
        vertexZ[b],
        vertexX[c],
        vertexY[c],
        vertexZ[c],
        center.x,
        center.y,
        center.z
    );
    addContourTriangleCandidateByCoordinates(
        triangles,
        vertexX[c],
        vertexY[c],
        vertexZ[c],
        vertexX[d],
        vertexY[d],
        vertexZ[d],
        center.x,
        center.y,
        center.z
    );
    addContourTriangleCandidateByCoordinates(
        triangles,
        vertexX[d],
        vertexY[d],
        vertexZ[d],
        vertexX[a],
        vertexY[a],
        vertexZ[a],
        center.x,
        center.y,
        center.z
    );
    addContourFaceCandidate(group, triangles, candidateVertexStore, sampleFunc, step);
}

function addContourTriangleCandidateByIndex(vertexX, vertexY, vertexZ, triangles, a, b, c) {
    addContourTriangleCandidateByCoordinates(
        triangles,
        vertexX[a],
        vertexY[a],
        vertexZ[a],
        vertexX[b],
        vertexY[b],
        vertexZ[b],
        vertexX[c],
        vertexY[c],
        vertexZ[c]
    );
}

function addContourTriangleCandidateByCoordinates(triangles, ax, ay, az, bx, by, bz, cx, cy, cz) {
    if (contourTriangleIsDegenerate(ax, ay, az, bx, by, bz, cx, cy, cz)) {
        return;
    }

    triangles.push(ax, ay, az, bx, by, bz, cx, cy, cz);
}

function addContourFaceCandidate(group, triangles, candidateVertexStore, sampleFunc, step) {
    let edgeCounts = null;

    if (triangles.length === 0) {
        return;
    }

    edgeCounts = buildContourCandidateEdgeCounts(triangles, candidateVertexStore);

    group.variants.push({
        order: group.variants.length,
        score: contourFaceCandidateScore(triangles, sampleFunc, step),
        triangles: triangles,
        edgeCounts: edgeCounts
    });
}

// Chooses one local triangulation variant per contour crossing, then flips ambiguous splits.
function emitSelectedContourFaceCandidates(candidateGroups, positions, sampleFunc, step, progressFunc, progressStepCount) {
    let selected = selectInitialContourFaceCandidates(candidateGroups);
    let groupIndex = 0;
    let candidate = null;

    resolveSelectedContourFaceConflicts(candidateGroups, selected, progressFunc, progressStepCount);

    for (groupIndex = 0; groupIndex < candidateGroups.length; groupIndex += 1) {
        candidate = selected[groupIndex];

        if (!candidate) {
            continue;
        }

        emitContourFaceCandidate(candidate, positions, sampleFunc, step);

        if (groupIndex % 1024 === 0) {
            reportMeshProgress(progressFunc, "Emitting contour faces", groupIndex / Math.max(candidateGroups.length, 1), 7, progressStepCount);
        }
    }

    reportMeshProgress(progressFunc, "Emitting contour faces", 1.0, 7, progressStepCount);
}

function selectInitialContourFaceCandidates(candidateGroups) {
    let selected = [];
    let groupIndex = 0;
    let group = null;

    for (groupIndex = 0; groupIndex < candidateGroups.length; groupIndex += 1) {
        group = candidateGroups[groupIndex];
        group.variants.sort(compareContourFaceCandidates);

        if (group.variants.length > 0) {
            selected[groupIndex] = group.variants[0];
        } else {
            selected[groupIndex] = null;
        }
    }

    return selected;
}

function resolveSelectedContourFaceConflicts(candidateGroups, selected, progressFunc, progressStepCount) {
    let pass = 0;
    let edgeStats = null;
    let entry = null;
    let passCount = 16;
    let changed = false;

    reportMeshProgress(progressFunc, "Resolving contour face conflicts", 0.0, 6, progressStepCount);

    for (pass = 0; pass < passCount; pass += 1) {
        edgeStats = buildSelectedContourCandidateEdgeStats(selected);
        changed = false;

        for (entry of edgeStats) {
            if (entry[1].count <= 2) {
                continue;
            }

            if (replaceConflictingContourCandidate(candidateGroups, selected, entry[0], entry[1])) {
                changed = true;
            }
        }

        reportMeshProgress(progressFunc, "Resolving contour face conflicts", (pass + 1) / passCount, 6, progressStepCount);

        if (!changed) {
            reportMeshProgress(progressFunc, "Resolving contour face conflicts", 1.0, 6, progressStepCount);
            return;
        }
    }
}

function replaceConflictingContourCandidate(candidateGroups, selected, edgeKey, edgeStat) {
    let participantIndex = 0;
    let groupIndex = 0;
    let selectedCandidate = null;
    let selectedEdgeCount = 0;
    let replacement = null;
    let replacementEdgeCount = 0;
    let reduction = 0;
    let scoreIncrease = 0.0;
    let bestGroupIndex = -1;
    let bestReplacement = null;
    let bestReduction = -1;
    let bestScoreIncrease = Infinity;

    for (participantIndex = 0; participantIndex < edgeStat.groups.length; participantIndex += 1) {
        groupIndex = edgeStat.groups[participantIndex];
        selectedCandidate = selected[groupIndex];

        if (!selectedCandidate) {
            continue;
        }

        selectedEdgeCount = selectedCandidate.edgeCounts.get(edgeKey);

        if (!selectedEdgeCount || selectedEdgeCount <= 1) {
            continue;
        }

        replacement = findContourCandidateReplacement(candidateGroups[groupIndex], selectedCandidate, edgeKey, selectedEdgeCount);

        if (replacement) {
            replacementEdgeCount = replacement.edgeCounts.get(edgeKey);

            if (!replacementEdgeCount) {
                replacementEdgeCount = 0;
            }

            reduction = selectedEdgeCount - replacementEdgeCount;
            scoreIncrease = replacement.score - selectedCandidate.score;

            if (reduction > bestReduction || (reduction === bestReduction && scoreIncrease < bestScoreIncrease)) {
                bestGroupIndex = groupIndex;
                bestReplacement = replacement;
                bestReduction = reduction;
                bestScoreIncrease = scoreIncrease;
            }
        }
    }

    if (bestReplacement) {
        selected[bestGroupIndex] = bestReplacement;
        return true;
    }

    return false;
}

function findContourCandidateReplacement(group, selectedCandidate, edgeKey, selectedEdgeCount) {
    let variantIndex = 0;
    let candidate = null;
    let candidateEdgeCount = 0;

    for (variantIndex = 0; variantIndex < group.variants.length; variantIndex += 1) {
        candidate = group.variants[variantIndex];

        if (candidate === selectedCandidate) {
            continue;
        }

        candidateEdgeCount = candidate.edgeCounts.get(edgeKey);

        if (!candidateEdgeCount) {
            candidateEdgeCount = 0;
        }

        if (candidateEdgeCount < selectedEdgeCount) {
            return candidate;
        }
    }

    return null;
}

function compareContourFaceCandidates(a, b) {
    if (a.score < b.score) {
        return -1;
    }

    if (a.score > b.score) {
        return 1;
    }

    if (a.order < b.order) {
        return -1;
    }

    if (a.order > b.order) {
        return 1;
    }

    return 0;
}

function buildSelectedContourCandidateEdgeStats(selected) {
    let edgeStats = new Map();
    let candidateIndex = 0;
    let candidate = null;
    let entry = null;
    let stats = null;

    for (candidateIndex = 0; candidateIndex < selected.length; candidateIndex += 1) {
        candidate = selected[candidateIndex];

        if (!candidate) {
            continue;
        }

        for (entry of candidate.edgeCounts) {
            stats = edgeStats.get(entry[0]);

            if (!stats) {
                stats = {
                    count: 0,
                    groups: []
                };
                edgeStats.set(entry[0], stats);
            }

            stats.count += entry[1];
            stats.groups.push(candidateIndex);
        }
    }

    return edgeStats;
}

function emitContourFaceCandidate(candidate, positions, sampleFunc, step) {
    let triangleOffset = 0;

    for (triangleOffset = 0; triangleOffset < candidate.triangles.length; triangleOffset += 9) {
        addFlatTriangleByCoordinates(
            positions,
            sampleFunc,
            step,
            candidate.triangles[triangleOffset],
            candidate.triangles[triangleOffset + 1],
            candidate.triangles[triangleOffset + 2],
            candidate.triangles[triangleOffset + 3],
            candidate.triangles[triangleOffset + 4],
            candidate.triangles[triangleOffset + 5],
            candidate.triangles[triangleOffset + 6],
            candidate.triangles[triangleOffset + 7],
            candidate.triangles[triangleOffset + 8]
        );
    }
}

function contourFaceCandidateScore(triangles, sampleFunc, step) {
    let triangleOffset = 0;
    let score = 0.0;

    for (triangleOffset = 0; triangleOffset < triangles.length; triangleOffset += 9) {
        score += contourTriangleCandidateScore(triangles, triangleOffset, sampleFunc, step);
    }

    return score;
}

function contourTriangleCandidateScore(triangles, offset, sampleFunc, step) {
    let centerX = (triangles[offset] + triangles[offset + 3] + triangles[offset + 6]) / 3.0;
    let centerY = (triangles[offset + 1] + triangles[offset + 4] + triangles[offset + 7]) / 3.0;
    let centerZ = (triangles[offset + 2] + triangles[offset + 5] + triangles[offset + 8]) / 3.0;
    let normal = contourTriangleNormal(
        triangles[offset],
        triangles[offset + 1],
        triangles[offset + 2],
        triangles[offset + 3],
        triangles[offset + 4],
        triangles[offset + 5],
        triangles[offset + 6],
        triangles[offset + 7],
        triangles[offset + 8]
    );
    let gradient = estimateGradient(sampleFunc, centerX, centerY, centerZ, step * 0.15);
    let alignment = Math.abs(normal.x * gradient.x + normal.y * gradient.y + normal.z * gradient.z);
    let score = Math.abs(sampleFunc(centerX, centerY, centerZ));

    score += (1.0 - alignment) * step * 0.02;
    return score;
}

function buildContourCandidateEdgeCounts(triangles, vertexStore) {
    let edgeCounts = new Map();
    let triangleOffset = 0;

    for (triangleOffset = 0; triangleOffset < triangles.length; triangleOffset += 9) {
        addContourCandidateEdge(edgeCounts, vertexStore, triangles, triangleOffset, 0, 3);
        addContourCandidateEdge(edgeCounts, vertexStore, triangles, triangleOffset, 3, 6);
        addContourCandidateEdge(edgeCounts, vertexStore, triangles, triangleOffset, 6, 0);
    }

    return edgeCounts;
}

function addContourCandidateEdge(edgeCounts, vertexStore, triangles, offset, a, b) {
    let first = contourCandidateVertexId(vertexStore, triangles[offset + a], triangles[offset + a + 1], triangles[offset + a + 2]);
    let second = contourCandidateVertexId(vertexStore, triangles[offset + b], triangles[offset + b + 1], triangles[offset + b + 2]);
    let key = contourPairId(first, second);
    let count = edgeCounts.get(key);

    if (!count) {
        count = 0;
    }

    edgeCounts.set(key, count + 1);
}

function contourCandidateVertexId(store, x, y, z) {
    return contourScaledVertexId(store, x, y, z, 100000.0);
}

function contourTriangleIsDegenerate(ax, ay, az, bx, by, bz, cx, cy, cz) {
    let normal = contourTriangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz);

    return normal.length <= 0.0000001;
}

function contourTriangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
    let ux = bx - ax;
    let uy = by - ay;
    let uz = bz - az;
    let vx = cx - ax;
    let vy = cy - ay;
    let vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    let lengthValue = Math.hypot(nx, ny, nz);

    if (lengthValue <= 0.0000001) {
        return {
            x: 0.0,
            y: 0.0,
            z: 1.0,
            length: lengthValue
        };
    }

    return {
        x: nx / lengthValue,
        y: ny / lengthValue,
        z: nz / lengthValue,
        length: lengthValue
    };
}

function triangleCenterError(sampleFunc, ax, ay, az, bx, by, bz, cx, cy, cz) {
    let centerX = (ax + bx + cx) / 3.0;
    let centerY = (ay + by + cy) / 3.0;
    let centerZ = (az + bz + cz) / 3.0;

    return Math.abs(sampleFunc(centerX, centerY, centerZ));
}

// Refines contour triangles in mesh-wide passes so shared edges split on both sides.
function refineContourMeshTriangles(sourcePositions, sampleFunc, step, minimumFeatureSize) {
    let positions = sourcePositions;
    let pass = 0;
    let splitData = null;
    let refined = null;

    for (pass = 0; pass < contourTriangleRefineDepth; pass += 1) {
        splitData = findContourMeshSplitEdges(positions, sampleFunc, step, minimumFeatureSize);

        if (splitData.edges.size === 0) {
            return positions;
        }

        refined = [];
        applyContourMeshSplitEdges(positions, refined, splitData, sampleFunc, step);
        positions = refined;
    }

    return positions;
}

// Collapses sub-micron contour slivers that otherwise become invalid after welding.
function cleanContourMeshTopology(sourcePositions, step) {
    let tolerance = contourTopologySnapTolerance(step);
    let vertexStore = createContourVertexStore();
    let positions = [];
    let triangleKeys = new Map();
    let index = 0;

    for (index = 0; index < sourcePositions.length; index += 9) {
        addCleanContourTriangle(positions, triangleKeys, vertexStore, sourcePositions, index, tolerance);
    }

    return positions;
}

function addCleanContourTriangle(positions, triangleKeys, vertexStore, sourcePositions, index, tolerance) {
    let ax = snapContourCoordinate(sourcePositions[index], tolerance);
    let ay = snapContourCoordinate(sourcePositions[index + 1], tolerance);
    let az = snapContourCoordinate(sourcePositions[index + 2], tolerance);
    let bx = snapContourCoordinate(sourcePositions[index + 3], tolerance);
    let by = snapContourCoordinate(sourcePositions[index + 4], tolerance);
    let bz = snapContourCoordinate(sourcePositions[index + 5], tolerance);
    let cx = snapContourCoordinate(sourcePositions[index + 6], tolerance);
    let cy = snapContourCoordinate(sourcePositions[index + 7], tolerance);
    let cz = snapContourCoordinate(sourcePositions[index + 8], tolerance);
    let aId = contourCleanupVertexId(vertexStore, ax, ay, az, tolerance);
    let bId = contourCleanupVertexId(vertexStore, bx, by, bz, tolerance);
    let cId = contourCleanupVertexId(vertexStore, cx, cy, cz, tolerance);

    if (aId === bId || bId === cId || cId === aId) {
        return;
    }

    if (contourTriangleIsDegenerate(ax, ay, az, bx, by, bz, cx, cy, cz)) {
        return;
    }

    if (!addContourTriangleId(triangleKeys, aId, bId, cId)) {
        return;
    }

    pushVertex(positions, ax, ay, az);
    pushVertex(positions, bx, by, bz);
    pushVertex(positions, cx, cy, cz);
}

function contourTopologySnapTolerance(step) {
    let tolerance = step * 0.003;

    if (tolerance > 0.002) {
        tolerance = 0.002;
    }

    if (tolerance < 0.00005) {
        tolerance = 0.00005;
    }

    return tolerance;
}

function snapContourCoordinate(value, tolerance) {
    return Math.round(value / tolerance) * tolerance;
}

function createContourVertexStore() {
    return {
        root: new Map(),
        x: [],
        y: [],
        z: []
    };
}

function contourCleanupVertexId(store, x, y, z, tolerance) {
    return contourIntegerVertexId(
        store,
        Math.round(x / tolerance),
        Math.round(y / tolerance),
        Math.round(z / tolerance),
        1.0 / tolerance
    );
}

function contourMeshVertexId(store, x, y, z) {
    return contourScaledVertexId(store, x, y, z, 100000.0);
}

function contourScaledVertexId(store, x, y, z, scale) {
    return contourIntegerVertexId(
        store,
        Math.round(x * scale),
        Math.round(y * scale),
        Math.round(z * scale),
        scale
    );
}

function contourIntegerVertexId(store, x, y, z, scale) {
    let yMap = store.root.get(x);
    let zMap = null;
    let id = 0;

    if (!yMap) {
        yMap = new Map();
        store.root.set(x, yMap);
    }

    zMap = yMap.get(y);

    if (!zMap) {
        zMap = new Map();
        yMap.set(y, zMap);
    }

    id = zMap.get(z);

    if (id === undefined) {
        id = store.x.length;
        zMap.set(z, id);
        store.x.push(x / scale);
        store.y.push(y / scale);
        store.z.push(z / scale);
    }

    return id;
}

function contourMeshPointFromId(store, id) {
    return {
        x: store.x[id],
        y: store.y[id],
        z: store.z[id]
    };
}

function contourPairId(a, b) {
    let first = a;
    let second = b;
    let swap = 0;
    let sum = 0;

    if (second < first) {
        swap = first;
        first = second;
        second = swap;
    }

    sum = first + second;
    return sum * (sum + 1) / 2 + second;
}

function addContourTriangleId(triangleKeys, a, b, c) {
    let first = a;
    let second = b;
    let third = c;
    let swap = 0;
    let secondMap = null;
    let thirdSet = null;

    if (second < first) {
        swap = first;
        first = second;
        second = swap;
    }

    if (third < second) {
        swap = second;
        second = third;
        third = swap;
    }

    if (second < first) {
        swap = first;
        first = second;
        second = swap;
    }

    secondMap = triangleKeys.get(first);

    if (!secondMap) {
        secondMap = new Map();
        triangleKeys.set(first, secondMap);
    }

    thirdSet = secondMap.get(second);

    if (!thirdSet) {
        thirdSet = new Set();
        secondMap.set(second, thirdSet);
    }

    if (thirdSet.has(third)) {
        return false;
    }

    thirdSet.add(third);
    return true;
}

// Collapses tiny collinear boundary seam loops left by tangent CSG contacts.
function repairContourMeshSeams(sourcePositions, sampleFunc, step) {
    let beforeStats = countContourMeshEdgeStats(sourcePositions);
    let components = null;
    let overusedCollapseMap = null;
    let filledPositions = null;
    let filledStats = null;
    let collapseMap = null;
    let repairedPositions = null;
    let afterStats = null;

    if (beforeStats.badEdgeCount === 0) {
        return sourcePositions;
    }

    components = buildContourOverusedComponents(beforeStats.edgeMap, beforeStats.vertexStore);
    overusedCollapseMap = buildContourOverusedCollapseMap(components, sampleFunc, step);

    if (overusedCollapseMap.size > 0) {
        repairedPositions = rebuildContourMeshWithCollapsedSeams(sourcePositions, overusedCollapseMap, beforeStats.vertexStore);
        afterStats = countContourMeshEdgeStats(repairedPositions);

        if (afterStats.badEdgeCount < beforeStats.badEdgeCount && afterStats.overusedEdgeCount <= beforeStats.overusedEdgeCount) {
            sourcePositions = repairedPositions;
            beforeStats = afterStats;

            if (beforeStats.badEdgeCount === 0) {
                return sourcePositions;
            }
        }
    }

    components = buildContourBoundaryComponents(beforeStats.edgeMap, beforeStats.vertexStore);
    filledPositions = fillContourBoundaryLoops(sourcePositions, components, sampleFunc, step);

    if (filledPositions !== sourcePositions) {
        filledStats = countContourMeshEdgeStats(filledPositions);

        if (filledStats.badEdgeCount < beforeStats.badEdgeCount && filledStats.overusedEdgeCount <= beforeStats.overusedEdgeCount) {
            sourcePositions = filledPositions;
            beforeStats = filledStats;

            if (beforeStats.badEdgeCount === 0) {
                return sourcePositions;
            }

            components = buildContourBoundaryComponents(beforeStats.edgeMap, beforeStats.vertexStore);
        }
    }

    collapseMap = buildContourSeamCollapseMap(components, sampleFunc, step);

    if (collapseMap.size === 0) {
        return sourcePositions;
    }

    repairedPositions = rebuildContourMeshWithCollapsedSeams(sourcePositions, collapseMap, beforeStats.vertexStore);
    afterStats = countContourMeshEdgeStats(repairedPositions);

    if (afterStats.badEdgeCount >= beforeStats.badEdgeCount) {
        return sourcePositions;
    }

    if (afterStats.overusedEdgeCount > beforeStats.overusedEdgeCount) {
        return sourcePositions;
    }

    return repairedPositions;
}

// Groups tiny overused seam edges so they can be collapsed before boundary repair.
function buildContourOverusedComponents(edgeMap, vertexStore) {
    let adjacency = new Map();
    let overusedEdges = [];
    let components = [];
    let edge = null;
    let seen = new Set();
    let edgeIndex = 0;
    let stack = [];
    let component = null;
    let current = null;

    for (edge of edgeMap.values()) {
        if (edge.count <= 2) {
            continue;
        }

        overusedEdges.push(edge);
        addContourBoundaryAdjacency(adjacency, edge.first, edge);
        addContourBoundaryAdjacency(adjacency, edge.second, edge);
    }

    for (edgeIndex = 0; edgeIndex < overusedEdges.length; edgeIndex += 1) {
        edge = overusedEdges[edgeIndex];

        if (seen.has(edge.key)) {
            continue;
        }

        component = {
            edges: [],
            vertices: [],
            vertexStore: vertexStore
        };
        stack = [edge];
        seen.add(edge.key);

        while (stack.length > 0) {
            current = stack.pop();
            component.edges.push(current);
            addContourComponentVertex(component.vertices, current.first);
            addContourComponentVertex(component.vertices, current.second);
            pushUnseenContourBoundaryEdges(stack, seen, adjacency, current.first);
            pushUnseenContourBoundaryEdges(stack, seen, adjacency, current.second);
        }

        components.push(component);
    }

    return components;
}

function buildContourOverusedCollapseMap(components, sampleFunc, step) {
    let collapseMap = new Map();
    let componentIndex = 0;
    let component = null;
    let point = null;
    let vertexId = 0;
    let vertexIndex = 0;

    for (componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
        component = components[componentIndex];
        point = contourOverusedCollapsePoint(component, sampleFunc, step);

        if (!point.ok) {
            continue;
        }

        for (vertexIndex = 0; vertexIndex < component.vertices.length; vertexIndex += 1) {
            vertexId = component.vertices[vertexIndex];
            collapseMap.set(vertexId, point);
        }
    }

    return collapseMap;
}

function contourOverusedCollapsePoint(component, sampleFunc, step) {
    let vertexId = 0;
    let vertexIndex = 0;
    let point = null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let averageX = 0.0;
    let averageY = 0.0;
    let averageZ = 0.0;
    let span = 0.0;
    let sampleValue = 0.0;
    let projected = null;
    let projectionDistance = 0.0;

    if (component.edges.length > 4 || component.vertices.length < 2 || component.vertices.length > 5) {
        return {
            ok: false
        };
    }

    for (vertexIndex = 0; vertexIndex < component.vertices.length; vertexIndex += 1) {
        vertexId = component.vertices[vertexIndex];
        point = contourMeshPointFromId(component.vertexStore, vertexId);
        averageX += point.x;
        averageY += point.y;
        averageZ += point.z;

        if (point.x < minX) {
            minX = point.x;
        }

        if (point.y < minY) {
            minY = point.y;
        }

        if (point.z < minZ) {
            minZ = point.z;
        }

        if (point.x > maxX) {
            maxX = point.x;
        }

        if (point.y > maxY) {
            maxY = point.y;
        }

        if (point.z > maxZ) {
            maxZ = point.z;
        }

        if (Math.abs(sampleFunc(point.x, point.y, point.z)) > step * 0.35) {
            return {
                ok: false
            };
        }
    }

    averageX /= component.vertices.length;
    averageY /= component.vertices.length;
    averageZ /= component.vertices.length;
    span = distanceBetweenPoints(minX, minY, minZ, maxX, maxY, maxZ);
    sampleValue = Math.abs(sampleFunc(averageX, averageY, averageZ));

    if (span > step * 1.5) {
        return {
            ok: false
        };
    }

    if (sampleValue > step * 0.05) {
        // Tangent CSG seams can leave a tiny overused edge whose averaged chord is off the SDF surface.
        projected = projectPointToSurface(sampleFunc, averageX, averageY, averageZ, step);
        projectionDistance = distanceBetweenPoints(averageX, averageY, averageZ, projected.x, projected.y, projected.z);
        sampleValue = Math.abs(sampleFunc(projected.x, projected.y, projected.z));

        if (projectionDistance > step * 0.75 || sampleValue > step * 0.05) {
            return {
                ok: false
            };
        }

        averageX = projected.x;
        averageY = projected.y;
        averageZ = projected.z;
    }

    return {
        ok: true,
        x: averageX,
        y: averageY,
        z: averageZ
    };
}

// Fills small closed boundary loops left by grid-aligned tangent features.
function fillContourBoundaryLoops(sourcePositions, components, sampleFunc, step) {
    let positions = sourcePositions;
    let componentIndex = 0;
    let component = null;
    let loop = null;
    let center = null;
    let pointIndex = 0;
    let nextIndex = 0;
    let a = null;
    let b = null;
    let addedCount = 0;

    for (componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
        component = components[componentIndex];
        loop = orderedContourBoundaryLoop(component);

        if (!loop.ok) {
            continue;
        }

        center = contourBoundaryLoopFillPoint(loop.points, sampleFunc, step);

        if (!center.ok) {
            continue;
        }

        if (positions === sourcePositions) {
            positions = sourcePositions.slice();
        }

        for (pointIndex = 0; pointIndex < loop.points.length; pointIndex += 1) {
            nextIndex = pointIndex + 1;

            if (nextIndex >= loop.points.length) {
                nextIndex = 0;
            }

            a = loop.points[pointIndex];
            b = loop.points[nextIndex];

            if (contourTriangleArea(a.x, a.y, a.z, b.x, b.y, b.z, center.x, center.y, center.z) > step * step * 0.00001) {
                addFlatTriangleByCoordinates(positions, sampleFunc, step, a.x, a.y, a.z, b.x, b.y, b.z, center.x, center.y, center.z);
                addedCount += 1;
            }
        }
    }

    if (addedCount === 0) {
        return sourcePositions;
    }

    return positions;
}

function orderedContourBoundaryLoop(component) {
    let vertices = component.vertices;
    let adjacency = new Map();
    let edgeIndex = 0;
    let edge = null;
    let start = -1;
    let current = -1;
    let previous = -1;
    let next = -1;
    let neighbors = null;
    let points = [];
    let guard = 0;

    if (vertices.length < 3 || vertices.length > 12 || component.edges.length !== vertices.length) {
        return {
            ok: false,
            points: []
        };
    }

    for (edgeIndex = 0; edgeIndex < component.edges.length; edgeIndex += 1) {
        edge = component.edges[edgeIndex];
        addContourLoopAdjacency(adjacency, edge.first, edge.second);
        addContourLoopAdjacency(adjacency, edge.second, edge.first);
    }

    for (edgeIndex = 0; edgeIndex < vertices.length; edgeIndex += 1) {
        neighbors = adjacency.get(vertices[edgeIndex]);

        if (!neighbors || neighbors.length !== 2) {
            return {
                ok: false,
                points: []
            };
        }
    }

    start = vertices[0];
    current = start;

    while (guard < vertices.length) {
        points.push(contourMeshPointFromId(component.vertexStore, current));
        neighbors = adjacency.get(current);
        next = neighbors[0];

        if (next === previous) {
            next = neighbors[1];
        }

        previous = current;
        current = next;
        guard += 1;

        if (current === start) {
            break;
        }
    }

    if (current !== start || points.length !== vertices.length) {
        return {
            ok: false,
            points: []
        };
    }

    return {
        ok: true,
        points: points
    };
}

function addContourLoopAdjacency(adjacency, vertex, neighbor) {
    let neighbors = adjacency.get(vertex);

    if (!neighbors) {
        neighbors = [];
        adjacency.set(vertex, neighbors);
    }

    neighbors.push(neighbor);
}

function contourBoundaryLoopFillPoint(points, sampleFunc, step) {
    let pointIndex = 0;
    let point = null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let x = 0.0;
    let y = 0.0;
    let z = 0.0;
    let span = 0.0;
    let projected = null;
    let value = 0.0;

    for (pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        point = points[pointIndex];
        x += point.x;
        y += point.y;
        z += point.z;

        if (point.x < minX) {
            minX = point.x;
        }

        if (point.y < minY) {
            minY = point.y;
        }

        if (point.z < minZ) {
            minZ = point.z;
        }

        if (point.x > maxX) {
            maxX = point.x;
        }

        if (point.y > maxY) {
            maxY = point.y;
        }

        if (point.z > maxZ) {
            maxZ = point.z;
        }

        if (Math.abs(sampleFunc(point.x, point.y, point.z)) > step * 0.05) {
            return {
                ok: false
            };
        }
    }

    x /= points.length;
    y /= points.length;
    z /= points.length;
    span = distanceBetweenPoints(minX, minY, minZ, maxX, maxY, maxZ);

    if (span > step * 2.0) {
        return {
            ok: false
        };
    }

    value = Math.abs(sampleFunc(x, y, z));

    if (value > step * 0.05) {
        projected = projectPointToSurface(sampleFunc, x, y, z, step);
        value = Math.abs(sampleFunc(projected.x, projected.y, projected.z));

        if (value > step * 0.05) {
            return {
                ok: false
            };
        }

        x = projected.x;
        y = projected.y;
        z = projected.z;
    }

    return {
        ok: true,
        x: x,
        y: y,
        z: z
    };
}

function countContourMeshEdgeStats(positions) {
    let meshTopology = buildContourMeshEdgeMap(positions);
    let edgeMap = meshTopology.edgeMap;
    let badEdgeCount = 0;
    let overusedEdgeCount = 0;
    let edge = null;

    for (edge of edgeMap.values()) {
        if (edge.count !== 2) {
            badEdgeCount += 1;
        }

        if (edge.count > 2) {
            overusedEdgeCount += 1;
        }
    }

    return {
        edgeMap: edgeMap,
        vertexStore: meshTopology.vertexStore,
        badEdgeCount: badEdgeCount,
        overusedEdgeCount: overusedEdgeCount
    };
}

function buildContourMeshEdgeMap(positions) {
    let vertexStore = createContourVertexStore();
    let edgeMap = new Map();
    let index = 0;

    for (index = 0; index < positions.length; index += 9) {
        addContourMeshEdgeCount(edgeMap, vertexStore, positions, index, index + 3);
        addContourMeshEdgeCount(edgeMap, vertexStore, positions, index + 3, index + 6);
        addContourMeshEdgeCount(edgeMap, vertexStore, positions, index + 6, index);
    }

    return {
        edgeMap: edgeMap,
        vertexStore: vertexStore
    };
}

function addContourMeshEdgeCount(edgeMap, vertexStore, positions, firstIndex, secondIndex) {
    let first = contourMeshVertexId(vertexStore, positions[firstIndex], positions[firstIndex + 1], positions[firstIndex + 2]);
    let second = contourMeshVertexId(vertexStore, positions[secondIndex], positions[secondIndex + 1], positions[secondIndex + 2]);
    let key = contourPairId(first, second);
    let edge = edgeMap.get(key);

    if (!edge) {
        edge = {
            key: key,
            first: first,
            second: second,
            count: 0
        };
        edgeMap.set(key, edge);
    }

    edge.count += 1;
}

function buildContourBoundaryComponents(edgeMap, vertexStore) {
    let adjacency = new Map();
    let boundaryEdges = [];
    let components = [];
    let edge = null;
    let seen = new Set();
    let edgeIndex = 0;
    let stack = [];
    let component = null;
    let current = null;

    for (edge of edgeMap.values()) {
        if (edge.count !== 1) {
            continue;
        }

        boundaryEdges.push(edge);
        addContourBoundaryAdjacency(adjacency, edge.first, edge);
        addContourBoundaryAdjacency(adjacency, edge.second, edge);
    }

    for (edgeIndex = 0; edgeIndex < boundaryEdges.length; edgeIndex += 1) {
        edge = boundaryEdges[edgeIndex];

        if (seen.has(edge.key)) {
            continue;
        }

        component = {
            edges: [],
            vertices: [],
            vertexStore: vertexStore
        };
        stack = [edge];
        seen.add(edge.key);

        while (stack.length > 0) {
            current = stack.pop();
            component.edges.push(current);
            addContourComponentVertex(component.vertices, current.first);
            addContourComponentVertex(component.vertices, current.second);
            pushUnseenContourBoundaryEdges(stack, seen, adjacency, current.first);
            pushUnseenContourBoundaryEdges(stack, seen, adjacency, current.second);
        }

        components.push(component);
    }

    return components;
}

function addContourBoundaryAdjacency(adjacency, vertex, edge) {
    let edges = adjacency.get(vertex);

    if (!edges) {
        edges = [];
        adjacency.set(vertex, edges);
    }

    edges.push(edge);
}

function addContourComponentVertex(vertices, vertex) {
    let index = 0;

    for (index = 0; index < vertices.length; index += 1) {
        if (vertices[index] === vertex) {
            return;
        }
    }

    vertices.push(vertex);
}

function pushUnseenContourBoundaryEdges(stack, seen, adjacency, vertex) {
    let edges = adjacency.get(vertex);
    let index = 0;
    let edge = null;

    if (!edges) {
        return;
    }

    for (index = 0; index < edges.length; index += 1) {
        edge = edges[index];

        if (!seen.has(edge.key)) {
            seen.add(edge.key);
            stack.push(edge);
        }
    }
}

function buildContourSeamCollapseMap(components, sampleFunc, step) {
    let collapseMap = new Map();
    let componentIndex = 0;
    let component = null;
    let point = null;
    let vertexId = 0;
    let vertexIndex = 0;

    for (componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
        component = components[componentIndex];
        point = contourSeamCollapsePoint(component, sampleFunc, step);

        if (!point.ok) {
            continue;
        }

        for (vertexIndex = 0; vertexIndex < component.vertices.length; vertexIndex += 1) {
            vertexId = component.vertices[vertexIndex];
            collapseMap.set(vertexId, point);
        }
    }

    return collapseMap;
}

function contourSeamCollapsePoint(component, sampleFunc, step) {
    let loop = null;
    let points = null;
    let vertexIndex = 0;
    let point = null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let averageX = 0.0;
    let averageY = 0.0;
    let averageZ = 0.0;
    let span = 0.0;
    let area = 0.0;
    let sampleValue = 0.0;

    if (component.edges.length < 3 || component.vertices.length < 3 || component.edges.length !== component.vertices.length) {
        return {
            ok: false
        };
    }

    loop = orderedContourBoundaryLoop(component);

    if (!loop.ok) {
        return {
            ok: false
        };
    }

    points = loop.points;

    for (vertexIndex = 0; vertexIndex < points.length; vertexIndex += 1) {
        point = points[vertexIndex];
        averageX += point.x;
        averageY += point.y;
        averageZ += point.z;

        if (point.x < minX) {
            minX = point.x;
        }

        if (point.y < minY) {
            minY = point.y;
        }

        if (point.z < minZ) {
            minZ = point.z;
        }

        if (point.x > maxX) {
            maxX = point.x;
        }

        if (point.y > maxY) {
            maxY = point.y;
        }

        if (point.z > maxZ) {
            maxZ = point.z;
        }

        if (sampleFunc(point.x, point.y, point.z) > step * 0.02) {
            return {
                ok: false
            };
        }
    }

    averageX /= points.length;
    averageY /= points.length;
    averageZ /= points.length;
    span = distanceBetweenPoints(minX, minY, minZ, maxX, maxY, maxZ);
    area = contourSeamComponentArea(points, averageX, averageY, averageZ);
    sampleValue = Math.abs(sampleFunc(averageX, averageY, averageZ));

    if (span > step * 1.5) {
        return {
            ok: false
        };
    }

    if (area > step * step * 0.0001) {
        return {
            ok: false
        };
    }

    if (sampleValue > step * 0.02) {
        return {
            ok: false
        };
    }

    return {
        ok: true,
        x: averageX,
        y: averageY,
        z: averageZ
    };
}

function contourSeamComponentArea(points, centerX, centerY, centerZ) {
    let area = 0.0;
    let pointIndex = 0;
    let nextIndex = 0;
    let a = null;
    let b = null;

    for (pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
        nextIndex = pointIndex + 1;

        if (nextIndex >= points.length) {
            nextIndex = 0;
        }

        a = points[pointIndex];
        b = points[nextIndex];
        area += contourTriangleArea(a.x, a.y, a.z, b.x, b.y, b.z, centerX, centerY, centerZ);
    }

    return area;
}

function rebuildContourMeshWithCollapsedSeams(sourcePositions, collapseMap, vertexStore) {
    let positions = [];
    let triangleKeys = new Map();
    let index = 0;

    for (index = 0; index < sourcePositions.length; index += 9) {
        addRepairedContourTriangle(positions, triangleKeys, vertexStore, sourcePositions, index, collapseMap);
    }

    return positions;
}

function addRepairedContourTriangle(positions, triangleKeys, vertexStore, sourcePositions, index, collapseMap) {
    let a = repairedContourPoint(sourcePositions, index, collapseMap, vertexStore);
    let b = repairedContourPoint(sourcePositions, index + 3, collapseMap, vertexStore);
    let c = repairedContourPoint(sourcePositions, index + 6, collapseMap, vertexStore);
    let aId = contourMeshVertexId(vertexStore, a.x, a.y, a.z);
    let bId = contourMeshVertexId(vertexStore, b.x, b.y, b.z);
    let cId = contourMeshVertexId(vertexStore, c.x, c.y, c.z);

    if (aId === bId || bId === cId || cId === aId) {
        return;
    }

    if (contourTriangleIsDegenerate(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)) {
        return;
    }

    if (!addContourTriangleId(triangleKeys, aId, bId, cId)) {
        return;
    }

    pushVertex(positions, a.x, a.y, a.z);
    pushVertex(positions, b.x, b.y, b.z);
    pushVertex(positions, c.x, c.y, c.z);
}

function repairedContourPoint(positions, index, collapseMap, vertexStore) {
    let id = contourMeshVertexId(vertexStore, positions[index], positions[index + 1], positions[index + 2]);
    let point = collapseMap.get(id);

    if (point) {
        return point;
    }

    return {
        x: positions[index],
        y: positions[index + 1],
        z: positions[index + 2]
    };
}

function contourTriangleArea(ax, ay, az, bx, by, bz, cx, cy, cz) {
    let ux = bx - ax;
    let uy = by - ay;
    let uz = bz - az;
    let vx = cx - ax;
    let vy = cy - ay;
    let vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;

    return Math.hypot(nx, ny, nz) * 0.5;
}

function findContourMeshSplitEdges(positions, sampleFunc, step, minimumFeatureSize) {
    let splitEdges = new Set();
    let vertexStore = createContourVertexStore();
    let index = 0;

    for (index = 0; index < positions.length; index += 9) {
        if (contourTriangleNeedsRefinement(positions, index, sampleFunc, step, minimumFeatureSize)) {
            splitEdges.add(contourRefinementEdgeId(vertexStore, positions, index, index + 3));
            splitEdges.add(contourRefinementEdgeId(vertexStore, positions, index + 3, index + 6));
            splitEdges.add(contourRefinementEdgeId(vertexStore, positions, index + 6, index));
        }
    }

    return {
        edges: splitEdges,
        vertexStore: vertexStore
    };
}

function contourTriangleNeedsRefinement(positions, index, sampleFunc, step, minimumFeatureSize) {
    let ax = positions[index];
    let ay = positions[index + 1];
    let az = positions[index + 2];
    let bx = positions[index + 3];
    let by = positions[index + 4];
    let bz = positions[index + 5];
    let cx = positions[index + 6];
    let cy = positions[index + 7];
    let cz = positions[index + 8];
    let centerValue = 0.0;

    if (!triangleCanSubdivide(ax, ay, az, bx, by, bz, cx, cy, cz, minimumFeatureSize)) {
        return false;
    }

    centerValue = triangleCenterError(sampleFunc, ax, ay, az, bx, by, bz, cx, cy, cz);

    return centerValue > step * contourTriangleRefineErrorScale;
}

function applyContourMeshSplitEdges(sourcePositions, targetPositions, splitData, sampleFunc, step) {
    let midpointCache = new Map();
    let index = 0;

    for (index = 0; index < sourcePositions.length; index += 9) {
        splitContourTriangle(sourcePositions, targetPositions, splitData, midpointCache, sampleFunc, step, index);
    }
}

function splitContourTriangle(positions, output, splitData, midpointCache, sampleFunc, step, index) {
    let vertexStore = splitData.vertexStore;
    let a = contourRefinementPointFromPositions(positions, index, vertexStore);
    let b = contourRefinementPointFromPositions(positions, index + 3, vertexStore);
    let c = contourRefinementPointFromPositions(positions, index + 6, vertexStore);
    let splitAB = splitData.edges.has(contourPairId(a.id, b.id));
    let splitBC = splitData.edges.has(contourPairId(b.id, c.id));
    let splitCA = splitData.edges.has(contourPairId(c.id, a.id));
    let ab = null;
    let bc = null;
    let ca = null;

    if (!splitAB && !splitBC && !splitCA) {
        pushContourRefinementTriangle(output, sampleFunc, step, a, b, c);
        return;
    }

    if (splitAB) {
        ab = contourRefinementMidpoint(midpointCache, sampleFunc, step, a, b);
    }

    if (splitBC) {
        bc = contourRefinementMidpoint(midpointCache, sampleFunc, step, b, c);
    }

    if (splitCA) {
        ca = contourRefinementMidpoint(midpointCache, sampleFunc, step, c, a);
    }

    pushSplitContourTriangle(output, sampleFunc, step, a, b, c, ab, bc, ca, splitAB, splitBC, splitCA);
}

function pushSplitContourTriangle(output, sampleFunc, step, a, b, c, ab, bc, ca, splitAB, splitBC, splitCA) {
    if (splitAB && splitBC && splitCA) {
        pushContourRefinementTriangle(output, sampleFunc, step, a, ab, ca);
        pushContourRefinementTriangle(output, sampleFunc, step, ab, b, bc);
        pushContourRefinementTriangle(output, sampleFunc, step, ca, bc, c);
        pushContourRefinementTriangle(output, sampleFunc, step, ab, bc, ca);
        return;
    }

    if (splitAB && splitBC) {
        pushContourRefinementTriangle(output, sampleFunc, step, ab, b, bc);
        pushContourRefinementTriangle(output, sampleFunc, step, a, ab, c);
        pushContourRefinementTriangle(output, sampleFunc, step, ab, bc, c);
        return;
    }

    if (splitBC && splitCA) {
        pushContourRefinementTriangle(output, sampleFunc, step, bc, c, ca);
        pushContourRefinementTriangle(output, sampleFunc, step, a, b, bc);
        pushContourRefinementTriangle(output, sampleFunc, step, a, bc, ca);
        return;
    }

    if (splitCA && splitAB) {
        pushContourRefinementTriangle(output, sampleFunc, step, ca, a, ab);
        pushContourRefinementTriangle(output, sampleFunc, step, ab, b, c);
        pushContourRefinementTriangle(output, sampleFunc, step, ab, c, ca);
        return;
    }

    if (splitAB) {
        pushContourRefinementTriangle(output, sampleFunc, step, a, ab, c);
        pushContourRefinementTriangle(output, sampleFunc, step, ab, b, c);
        return;
    }

    if (splitBC) {
        pushContourRefinementTriangle(output, sampleFunc, step, a, b, bc);
        pushContourRefinementTriangle(output, sampleFunc, step, a, bc, c);
        return;
    }

    pushContourRefinementTriangle(output, sampleFunc, step, a, b, ca);
    pushContourRefinementTriangle(output, sampleFunc, step, b, c, ca);
}

function pushContourRefinementTriangle(output, sampleFunc, step, a, b, c) {
    addFlatTriangleByCoordinates(
        output,
        sampleFunc,
        step,
        a.x,
        a.y,
        a.z,
        b.x,
        b.y,
        b.z,
        c.x,
        c.y,
        c.z
    );
}

function contourRefinementMidpoint(midpointCache, sampleFunc, step, a, b) {
    let key = contourRefinementPointEdgeId(a, b);
    let midpoint = midpointCache.get(key);

    if (midpoint) {
        return midpoint;
    }

    midpoint = projectTriangleMidpoint(sampleFunc, step, a.x, a.y, a.z, b.x, b.y, b.z);
    midpointCache.set(key, midpoint);

    return midpoint;
}

function contourRefinementPointFromPositions(positions, index, vertexStore) {
    return {
        x: positions[index],
        y: positions[index + 1],
        z: positions[index + 2],
        id: contourRefinementVertexId(vertexStore, positions[index], positions[index + 1], positions[index + 2])
    };
}

function contourRefinementEdgeId(vertexStore, positions, firstIndex, secondIndex) {
    let a = contourRefinementVertexId(vertexStore, positions[firstIndex], positions[firstIndex + 1], positions[firstIndex + 2]);
    let b = contourRefinementVertexId(vertexStore, positions[secondIndex], positions[secondIndex + 1], positions[secondIndex + 2]);

    return contourPairId(a, b);
}

function contourRefinementPointEdgeId(a, b) {
    return contourPairId(a.id, b.id);
}

function contourRefinementVertexId(store, x, y, z) {
    return contourScaledVertexId(store, x, y, z, 1000000.0);
}

function createContourCellWorkspace() {
    return {
        edgeActive: new Uint8Array(12),
        edgeParent: new Int8Array(12),
        pointX: new Float64Array(12),
        pointY: new Float64Array(12),
        pointZ: new Float64Array(12),
        normalX: new Float64Array(12),
        normalY: new Float64Array(12),
        normalZ: new Float64Array(12),
        activeEdges: new Int8Array(4),
        processed: new Uint8Array(12)
    };
}

function resetContourCellWorkspace(workspace) {
    let index = 0;

    for (index = 0; index < 12; index += 1) {
        workspace.edgeActive[index] = 0;
        workspace.edgeParent[index] = -1;
        workspace.processed[index] = 0;
    }
}

function computeContourCellVertices(sampleFunc, x, y, z, step, cornerValues, cellEdgeVertices, cellOffset, vertexX, vertexY, vertexZ, workspace) {
    let edgeActive = workspace.edgeActive;
    let edgeParent = workspace.edgeParent;
    let pointX = workspace.pointX;
    let pointY = workspace.pointY;
    let pointZ = workspace.pointZ;
    let normalX = workspace.normalX;
    let normalY = workspace.normalY;
    let normalZ = workspace.normalZ;
    let edgeIndex = 0;
    let a = 0;
    let b = 0;
    let va = 0.0;
    let vb = 0.0;
    let t = 0.5;
    let px = 0.0;
    let py = 0.0;
    let pz = 0.0;
    let normal = null;
    let projected = null;

    resetContourCellWorkspace(workspace);

    for (edgeIndex = 0; edgeIndex < 12; edgeIndex += 1) {
        a = cubeEdgeA[edgeIndex];
        b = cubeEdgeB[edgeIndex];
        va = cornerValues[a];
        vb = cornerValues[b];

        if (valuesCross(va, vb)) {
            t = edgeInterpolation(va, vb);
            px = x + (cubeCornerX[a] + (cubeCornerX[b] - cubeCornerX[a]) * t) * step;
            py = y + (cubeCornerY[a] + (cubeCornerY[b] - cubeCornerY[a]) * t) * step;
            pz = z + (cubeCornerZ[a] + (cubeCornerZ[b] - cubeCornerZ[a]) * t) * step;
            projected = projectPointToSurface(sampleFunc, px, py, pz, step);

            if (pointInsideCell(projected.x, projected.y, projected.z, x, y, z, step)) {
                px = projected.x;
                py = projected.y;
                pz = projected.z;
            }

            normal = estimateGradient(sampleFunc, px, py, pz, step * 0.15);
            edgeActive[edgeIndex] = 1;
            edgeParent[edgeIndex] = edgeIndex;
            pointX[edgeIndex] = px;
            pointY[edgeIndex] = py;
            pointZ[edgeIndex] = pz;
            normalX[edgeIndex] = normal.x;
            normalY[edgeIndex] = normal.y;
            normalZ[edgeIndex] = normal.z;
        }
    }

    connectContourCellComponents(sampleFunc, x, y, z, step, cornerValues, edgeActive, edgeParent, workspace);
    addContourCellComponentVertices(
        sampleFunc,
        x,
        y,
        z,
        step,
        edgeActive,
        edgeParent,
        pointX,
        pointY,
        pointZ,
        normalX,
        normalY,
        normalZ,
        cellEdgeVertices,
        cellOffset,
        vertexX,
        vertexY,
        vertexZ,
        workspace
    );
}

function connectContourCellComponents(sampleFunc, x, y, z, step, cornerValues, edgeActive, edgeParent, workspace) {
    let faceIndex = 0;
    let faceBase = 0;
    let localIndex = 0;
    let edge = 0;
    let activeEdges = workspace.activeEdges;
    let activeCount = 0;

    for (faceIndex = 0; faceIndex < 6; faceIndex += 1) {
        faceBase = faceIndex * 4;
        activeCount = 0;

        for (localIndex = 0; localIndex < 4; localIndex += 1) {
            edge = cubeFaceEdges[faceBase + localIndex];

            if (edgeActive[edge]) {
                activeEdges[activeCount] = edge;
                activeCount += 1;
            }
        }

        if (activeCount === 2) {
            unionContourCellComponents(edgeParent, activeEdges[0], activeEdges[1]);
        } else if (activeCount === 4) {
            connectAmbiguousContourCellFace(sampleFunc, x, y, z, step, cornerValues, edgeParent, faceBase);
        }
    }
}

function connectAmbiguousContourCellFace(sampleFunc, x, y, z, step, cornerValues, edgeParent, faceBase) {
    let centerX = 0.0;
    let centerY = 0.0;
    let centerZ = 0.0;
    let centerInside = false;
    let localIndex = 0;
    let corner = 0;
    let cornerInside = false;
    let currentEdge = 0;
    let previousEdge = 0;

    for (localIndex = 0; localIndex < 4; localIndex += 1) {
        corner = cubeFaceCorners[faceBase + localIndex];
        centerX += cubeCornerX[corner];
        centerY += cubeCornerY[corner];
        centerZ += cubeCornerZ[corner];
    }

    centerX = x + centerX * 0.25 * step;
    centerY = y + centerY * 0.25 * step;
    centerZ = z + centerZ * 0.25 * step;
    centerInside = sampleFunc(centerX, centerY, centerZ) < 0.0;

    for (localIndex = 0; localIndex < 4; localIndex += 1) {
        corner = cubeFaceCorners[faceBase + localIndex];
        cornerInside = cornerValues[corner] < 0.0;

        if (cornerInside === centerInside) {
            currentEdge = cubeFaceEdges[faceBase + localIndex];

            if (localIndex === 0) {
                previousEdge = cubeFaceEdges[faceBase + 3];
            } else {
                previousEdge = cubeFaceEdges[faceBase + localIndex - 1];
            }

            unionContourCellComponents(edgeParent, previousEdge, currentEdge);
        }
    }
}

function addContourCellComponentVertices(sampleFunc, x, y, z, step, edgeActive, edgeParent, pointX, pointY, pointZ, normalX, normalY, normalZ, cellEdgeVertices, cellOffset, vertexX, vertexY, vertexZ, workspace) {
    let processed = workspace.processed;
    let edgeIndex = 0;
    let assignEdge = 0;
    let root = 0;
    let vertex = null;
    let vertexIndex = 0;

    for (edgeIndex = 0; edgeIndex < 12; edgeIndex += 1) {
        if (!edgeActive[edgeIndex]) {
            continue;
        }

        root = contourCellComponentRoot(edgeParent, edgeIndex);

        if (processed[root]) {
            continue;
        }

        processed[root] = 1;
        vertex = computeContourComponentVertex(sampleFunc, x, y, z, step, edgeActive, edgeParent, root, pointX, pointY, pointZ, normalX, normalY, normalZ);
        vertexIndex = vertexX.length;
        vertexX.push(vertex.x);
        vertexY.push(vertex.y);
        vertexZ.push(vertex.z);

        for (assignEdge = 0; assignEdge < 12; assignEdge += 1) {
            if (edgeActive[assignEdge] && contourCellComponentRoot(edgeParent, assignEdge) === root) {
                cellEdgeVertices[cellOffset * 12 + assignEdge] = vertexIndex;
            }
        }
    }
}

function computeContourComponentVertex(sampleFunc, x, y, z, step, edgeActive, edgeParent, root, pointX, pointY, pointZ, normalX, normalY, normalZ) {
    let qef = createQef();
    let averageX = 0.0;
    let averageY = 0.0;
    let averageZ = 0.0;
    let count = 0;
    let edgeIndex = 0;
    let normal = null;
    let solved = null;

    for (edgeIndex = 0; edgeIndex < 12; edgeIndex += 1) {
        if (!edgeActive[edgeIndex] || contourCellComponentRoot(edgeParent, edgeIndex) !== root) {
            continue;
        }

        normal = {
            x: normalX[edgeIndex],
            y: normalY[edgeIndex],
            z: normalZ[edgeIndex]
        };
        addQefPlane(qef, normal, pointX[edgeIndex], pointY[edgeIndex], pointZ[edgeIndex]);
        averageX += pointX[edgeIndex];
        averageY += pointY[edgeIndex];
        averageZ += pointZ[edgeIndex];
        count += 1;
    }

    if (count === 0) {
        return {
            x: x + step * 0.5,
            y: y + step * 0.5,
            z: z + step * 0.5
        };
    }

    averageX /= count;
    averageY /= count;
    averageZ /= count;
    solved = solveQef(qef, averageX, averageY, averageZ);

    if (solved.ok && pointInsideCell(solved.x, solved.y, solved.z, x, y, z, step)) {
        return snapContourVertexToCrease(
            sampleFunc,
            step,
            repairContourVertex(
                sampleFunc,
                x,
                y,
                z,
                step,
                {
                    x: solved.x,
                    y: solved.y,
                    z: solved.z
                }
            )
        );
    }

    if (solved.ok && pointNearCell(solved.x, solved.y, solved.z, x, y, z, step) && Math.abs(sampleFunc(solved.x, solved.y, solved.z)) <= step * 0.001) {
        return snapContourVertexToCrease(sampleFunc, step, {
            x: solved.x,
            y: solved.y,
            z: solved.z
        });
    }

    return snapContourVertexToCrease(
        sampleFunc,
        step,
        repairContourVertex(
            sampleFunc,
            x,
            y,
            z,
            step,
            {
                x: averageX,
                y: averageY,
                z: averageZ
            }
        )
    );
}

function unionContourCellComponents(edgeParent, a, b) {
    let rootA = contourCellComponentRoot(edgeParent, a);
    let rootB = contourCellComponentRoot(edgeParent, b);

    if (rootA < 0 || rootB < 0 || rootA === rootB) {
        return;
    }

    if (rootB < rootA) {
        edgeParent[rootA] = rootB;
    } else {
        edgeParent[rootB] = rootA;
    }
}

function contourCellComponentRoot(edgeParent, edge) {
    let root = edge;
    let parent = edgeParent[root];

    if (parent < 0) {
        return -1;
    }

    while (parent !== root) {
        root = parent;
        parent = edgeParent[root];

        if (parent < 0) {
            return -1;
        }
    }

    return root;
}

function repairContourVertex(sampleFunc, x, y, z, step, vertex) {
    let value = sampleFunc(vertex.x, vertex.y, vertex.z);
    let projected = null;

    if (Math.abs(value) <= step * 0.0005) {
        return vertex;
    }

    projected = projectPointToSurface(sampleFunc, vertex.x, vertex.y, vertex.z, step);

    if (pointInsideCell(projected.x, projected.y, projected.z, x, y, z, step)) {
        return {
            x: projected.x,
            y: projected.y,
            z: projected.z
        };
    }

    return {
        x: vertex.x,
        y: vertex.y,
        z: vertex.z
    };
}

function snapContourVertexToCrease(sampleFunc, step, vertex) {
    let snapped = projectHorizontalCreaseVertexToWall(sampleFunc, step, vertex.x, vertex.y, vertex.z);

    if (snapped.changed) {
        return {
            x: snapped.x,
            y: snapped.y,
            z: snapped.z
        };
    }

    snapped = projectVerticalCreaseVertexToCap(sampleFunc, step, vertex.x, vertex.y, vertex.z);

    if (snapped.changed) {
        return {
            x: snapped.x,
            y: snapped.y,
            z: snapped.z
        };
    }

    return vertex;
}

function projectVerticalCreaseVertexToCap(sampleFunc, step, x, y, z) {
    let gradient = estimateGradient(sampleFunc, x, y, z, step * 0.15);
    let absGradientX = Math.abs(gradient.x);
    let absGradientY = Math.abs(gradient.y);
    let insideX = x - gradient.x * step * 0.2;
    let insideY = y - gradient.y * step * 0.2;
    let insideZ = z - gradient.z * step * 0.2;
    let insideValue = sampleFunc(insideX, insideY, insideZ);
    let up = null;
    let down = null;
    let selected = null;

    if (Math.abs(gradient.z) > 0.55) {
        return {
            changed: false,
            x: x,
            y: y,
            z: z
        };
    }

    if (absGradientX > 0.995 || absGradientY > 0.995) {
        return {
            changed: false,
            x: x,
            y: y,
            z: z
        };
    }

    if (insideValue >= -step * 0.001) {
        insideX = x + gradient.x * step * 0.2;
        insideY = y + gradient.y * step * 0.2;
        insideZ = z + gradient.z * step * 0.2;
        insideValue = sampleFunc(insideX, insideY, insideZ);
    }

    if (insideValue >= -step * 0.001) {
        return {
            changed: false,
            x: x,
            y: y,
            z: z
        };
    }

    down = findCapProjectionAlongZ(sampleFunc, step, insideX, insideY, insideZ, -1.0, x, y);
    up = findCapProjectionAlongZ(sampleFunc, step, insideX, insideY, insideZ, 1.0, x, y);

    if (down.ok) {
        selected = down;
    }

    if (up.ok) {
        if (!selected || Math.abs(up.z - z) < Math.abs(selected.z - z)) {
            selected = up;
        }
    }

    if (!selected) {
        return {
            changed: false,
            x: x,
            y: y,
            z: z
        };
    }

    if (Math.abs(selected.z - z) > step * 1.2) {
        return {
            changed: false,
            x: x,
            y: y,
            z: z
        };
    }

    if (Math.abs(selected.z - z) <= step * 0.0001) {
        return {
            changed: false,
            x: x,
            y: y,
            z: z
        };
    }

    return {
        changed: true,
        x: x,
        y: y,
        z: selected.z
    };
}

function findCapProjectionAlongZ(sampleFunc, step, insideX, insideY, insideZ, direction, surfaceX, surfaceY) {
    let endZ = insideZ + direction * step * 1.25;
    let startValue = sampleFunc(insideX, insideY, insideZ);
    let endValue = sampleFunc(insideX, insideY, endZ);
    let lowZ = insideZ;
    let highZ = endZ;
    let lowValue = startValue;
    let highValue = endValue;
    let midZ = 0.0;
    let midValue = 0.0;
    let iteration = 0;
    let candidateValue = 0.0;

    if (startValue * endValue > 0.0) {
        return {
            ok: false,
            z: 0.0
        };
    }

    for (iteration = 0; iteration < 16; iteration += 1) {
        midZ = (lowZ + highZ) * 0.5;
        midValue = sampleFunc(insideX, insideY, midZ);

        if (lowValue * midValue <= 0.0) {
            highZ = midZ;
            highValue = midValue;
        } else {
            lowZ = midZ;
            lowValue = midValue;
        }
    }

    candidateValue = sampleFunc(surfaceX, surfaceY, highZ);

    if (Math.abs(candidateValue) > step * 0.001) {
        return {
            ok: false,
            z: 0.0
        };
    }

    return {
        ok: true,
        z: highZ
    };
}

// Keeps subdivision midpoints on an axis-aligned face when they are already on the SDF surface.
function projectTriangleMidpoint(sampleFunc, step, ax, ay, az, bx, by, bz) {
    let mx = (ax + bx) * 0.5;
    let my = (ay + by) * 0.5;
    let mz = (az + bz) * 0.5;
    let tolerance = step * 0.001;

    if (Math.abs(sampleFunc(mx, my, mz)) <= tolerance) {
        if (Math.abs(ax - bx) <= tolerance || Math.abs(ay - by) <= tolerance || Math.abs(az - bz) <= tolerance) {
            return {
                x: mx,
                y: my,
                z: mz
            };
        }
    }

    return projectPointToSurface(sampleFunc, mx, my, mz, step);
}

function triangleCanSubdivide(ax, ay, az, bx, by, bz, cx, cy, cz, minimumFeatureSize) {
    let ab = distanceBetweenPoints(ax, ay, az, bx, by, bz);
    let bc = distanceBetweenPoints(bx, by, bz, cx, cy, cz);
    let ca = distanceBetweenPoints(cx, cy, cz, ax, ay, az);
    let minimumSide = ab;

    if (bc < minimumSide) {
        minimumSide = bc;
    }

    if (ca < minimumSide) {
        minimumSide = ca;
    }

    return minimumSide >= minimumFeatureSize * 2.0;
}

function distanceBetweenPoints(ax, ay, az, bx, by, bz) {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;

    return Math.hypot(dx, dy, dz);
}

function addFlatTriangleByCoordinates(positions, sampleFunc, step, ax, ay, az, bx, by, bz, cx, cy, cz) {
    let ux = bx - ax;
    let uy = by - ay;
    let uz = bz - az;
    let vx = cx - ax;
    let vy = cy - ay;
    let vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    let normalLength = Math.hypot(nx, ny, nz);
    let centerX = (ax + bx + cx) / 3.0;
    let centerY = (ay + by + cy) / 3.0;
    let centerZ = (az + bz + cz) / 3.0;
    let probe = 0.0;

    if (normalLength <= 0.0000001) {
        return;
    }

    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;

    probe = sampleFunc(
        centerX + nx * step * 0.20,
        centerY + ny * step * 0.20,
        centerZ + nz * step * 0.20
    );

    if (probe < 0.0) {
        pushVertex(positions, ax, ay, az);
        pushVertex(positions, cx, cy, cz);
        pushVertex(positions, bx, by, bz);
    } else {
        pushVertex(positions, ax, ay, az);
        pushVertex(positions, bx, by, bz);
        pushVertex(positions, cx, cy, cz);
    }
}

function projectHorizontalCreaseVertexToWall(sampleFunc, step, x, y, z) {
    let gradient = estimateGradient(sampleFunc, x, y, z, step * 0.15);
    let probeZ = z;
    let projected = null;
    let candidateValue = 0.0;
    let dx = 0.0;
    let dy = 0.0;
    let maxMove = step * 1.5;

    if (Math.abs(gradient.z) < 0.7) {
        return {
            cap: false,
            changed: false,
            x: x,
            y: y,
            z: z
        };
    }

    if (gradient.z > 0.0) {
        probeZ -= step * 0.75;
    } else {
        probeZ += step * 0.75;
    }

    projected = projectPointToSurface(sampleFunc, x, y, probeZ, step);
    candidateValue = sampleFunc(projected.x, projected.y, z);
    dx = projected.x - x;
    dy = projected.y - y;

    if (Math.abs(candidateValue) > step * 0.001) {
        return {
            cap: true,
            changed: false,
            x: x,
            y: y,
            z: z
        };
    }

    if (dx * dx + dy * dy > maxMove * maxMove) {
        return {
            cap: true,
            changed: false,
            x: x,
            y: y,
            z: z
        };
    }

    if (Math.abs(dx) <= step * 0.0001 && Math.abs(dy) <= step * 0.0001) {
        return {
            cap: true,
            changed: false,
            x: x,
            y: y,
            z: z
        };
    }

    return {
        cap: true,
        changed: true,
        x: projected.x,
        y: projected.y,
        z: z
    };
}

function cellHasSurface(cornerValues) {
    let index = 0;
    let hasInside = false;
    let hasOutside = false;
    let cornerInside = false;

    for (index = 0; index < 8; index += 1) {
        cornerInside = cornerValues[index] < 0.0;
        hasInside = hasInside || cornerInside;
        hasOutside = hasOutside || !cornerInside;
    }

    return hasInside && hasOutside;
}

function valuesCross(a, b) {
    return (a < 0.0 && b >= 0.0) || (a >= 0.0 && b < 0.0);
}

function edgeInterpolation(a, b) {
    let denom = a - b;

    if (Math.abs(denom) <= 0.000001) {
        return 0.5;
    }

    return a / denom;
}

function estimateGradient(sampleFunc, x, y, z, epsilon) {
    let e = cleanPositive(epsilon, 0.01);
    let nx = sampleFunc(x + e, y, z) - sampleFunc(x - e, y, z);
    let ny = sampleFunc(x, y + e, z) - sampleFunc(x, y - e, z);
    let nz = sampleFunc(x, y, z + e) - sampleFunc(x, y, z - e);
    let lengthValue = Math.hypot(nx, ny, nz);

    if (lengthValue <= 0.0000001) {
        return {
            x: 0.0,
            y: 0.0,
            z: 1.0
        };
    }

    return {
        x: nx / lengthValue,
        y: ny / lengthValue,
        z: nz / lengthValue
    };
}

function createQef() {
    return {
        a00: 0.0,
        a01: 0.0,
        a02: 0.0,
        a11: 0.0,
        a12: 0.0,
        a22: 0.0,
        b0: 0.0,
        b1: 0.0,
        b2: 0.0
    };
}

function addQefPlane(qef, normal, x, y, z) {
    let d = normal.x * x + normal.y * y + normal.z * z;

    qef.a00 += normal.x * normal.x;
    qef.a01 += normal.x * normal.y;
    qef.a02 += normal.x * normal.z;
    qef.a11 += normal.y * normal.y;
    qef.a12 += normal.y * normal.z;
    qef.a22 += normal.z * normal.z;
    qef.b0 += normal.x * d;
    qef.b1 += normal.y * d;
    qef.b2 += normal.z * d;
}

function solveQef(qef, targetX, targetY, targetZ) {
    let bias = 0.000001;
    let a00 = qef.a00 + bias;
    let a11 = qef.a11 + bias;
    let a22 = qef.a22 + bias;
    let b0 = qef.b0 + targetX * bias;
    let b1 = qef.b1 + targetY * bias;
    let b2 = qef.b2 + targetZ * bias;
    let det = a00 * (a11 * a22 - qef.a12 * qef.a12)
        - qef.a01 * (qef.a01 * a22 - qef.a12 * qef.a02)
        + qef.a02 * (qef.a01 * qef.a12 - a11 * qef.a02);
    let x = 0.0;
    let y = 0.0;
    let z = 0.0;

    if (Math.abs(det) <= 0.0000000001) {
        return {
            ok: false,
            x: 0.0,
            y: 0.0,
            z: 0.0
        };
    }

    x = (b0 * (a11 * a22 - qef.a12 * qef.a12)
        - qef.a01 * (b1 * a22 - qef.a12 * b2)
        + qef.a02 * (b1 * qef.a12 - a11 * b2)) / det;
    y = (a00 * (b1 * a22 - qef.a12 * b2)
        - b0 * (qef.a01 * a22 - qef.a12 * qef.a02)
        + qef.a02 * (qef.a01 * b2 - b1 * qef.a02)) / det;
    z = (a00 * (a11 * b2 - b1 * qef.a12)
        - qef.a01 * (qef.a01 * b2 - b1 * qef.a02)
        + b0 * (qef.a01 * qef.a12 - a11 * qef.a02)) / det;

    return {
        ok: true,
        x: x,
        y: y,
        z: z
    };
}

function pointInsideCell(px, py, pz, x, y, z, step) {
    let tolerance = step * 0.05;

    return px >= x - tolerance
        && px <= x + step + tolerance
        && py >= y - tolerance
        && py <= y + step + tolerance
        && pz >= z - tolerance
        && pz <= z + step + tolerance;
}

// Allows a QEF crease solution slightly outside its cell before falling back to the averaged point.
function pointNearCell(px, py, pz, x, y, z, step) {
    let tolerance = step * 0.5;

    return px >= x - tolerance
        && px <= x + step + tolerance
        && py >= y - tolerance
        && py <= y + step + tolerance
        && pz >= z - tolerance
        && pz <= z + step + tolerance;
}

function gridIndex(x, y, z, gridSize) {
    return z * gridSize * gridSize + y * gridSize + x;
}

function cellIndex(x, y, z, cellCount) {
    return z * cellCount * cellCount + y * cellCount + x;
}

function voxelLocalX(bit) {
    return bit & 1;
}

function voxelLocalY(bit) {
    return (bit >> 1) & 1;
}

function voxelLocalZ(bit) {
    return (bit >> 2) & 1;
}

function connectedVoxelMaskComponent(mask, seed) {
    let stack = new Int8Array(8);
    let stackSize = 1;
    let component = 1 << seed;
    let bit = 0;
    let neighbor = 0;
    let axis = 0;
    let neighborBit = 0;

    stack[0] = seed;

    while (stackSize > 0) {
        stackSize -= 1;
        bit = stack[stackSize];

        for (axis = 0; axis < 3; axis += 1) {
            neighbor = bit ^ (1 << axis);
            neighborBit = 1 << neighbor;

            if ((mask & neighborBit) !== 0 && (component & neighborBit) === 0) {
                component |= neighborBit;
                stack[stackSize] = neighbor;
                stackSize += 1;
            }
        }
    }

    return component;
}

function reportMeshProgress(progressFunc, label, progressValue, stepIndex, stepCount) {
    if (!progressFunc) {
        return;
    }

    progressFunc(label, Math.min(Math.max(progressValue, 0.0), 1.0), stepIndex, stepCount);
}

function cleanResolution(resolution) {
    let value = Math.floor(Number(resolution));

    if (!Number.isFinite(value)) {
        value = 24;
    }

    if (value < 4) {
        value = 4;
    }

    return value;
}

function cleanPositive(value, fallback) {
    let numberValue = Number(value);

    if (!Number.isFinite(numberValue) || numberValue <= 0.0) {
        return fallback;
    }

    return numberValue;
}

function cleanMeshBounds(value) {
    let cleanBound = 0.0;
    let minX = 0.0;
    let minY = 0.0;
    let minZ = 0.0;
    let size = 0.0;
    let boundValue = 0.0;
    let padding = 0.0;

    if (value && typeof value === "object") {
        minX = Number(value.minX);
        minY = Number(value.minY);
        minZ = Number(value.minZ);
        size = Number(value.size);
        boundValue = Number(value.bound);
        padding = Number(value.padding);

        if (!Number.isFinite(boundValue) || boundValue <= 0.0) {
            boundValue = size;
        }

        if (!Number.isFinite(padding) || padding < 0.0) {
            padding = 0.0;
        }

        if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(minZ) && Number.isFinite(size) && size > 0.0) {
            return {
                minX: minX,
                minY: minY,
                minZ: minZ,
                size: size,
                boundValue: boundValue,
                padding: padding
            };
        }
    }

    cleanBound = cleanPositive(value, 120.0);

    return {
        minX: -cleanBound,
        minY: -cleanBound,
        minZ: -cleanBound,
        size: cleanBound * 2.0,
        boundValue: cleanBound,
        padding: 0.0
    };
}
