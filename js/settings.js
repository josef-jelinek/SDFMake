const defaultMeshMethod = "contour-fit";
const meshMethodIds = [
    "voxel",
    "voxel-blend",
    "marching-tetrahedra",
    "contour-fit"
];
const meshMethodLabels = [
    "Voxel",
    "Voxel blend",
    "Marching tetrahedra",
    "Contour fit"
];
const meshMethodStepCounts = new Int8Array([3, 3, 2, 8]);
const meshMethodSubdivisionFlags = new Int8Array([1, 1, 0, 1]);
const meshMetadataFields = [
    "triangleCount",
    "resolution",
    "cellSize",
    "minimumFeatureSize",
    "subdivisions",
    "voxelOccupiedCellCount",
    "bound",
    "padding",
    "minX",
    "minY",
    "minZ",
    "maxX",
    "maxY",
    "maxZ",
    "method",
    "methodLabel"
];

export function cleanSubdivisionsValue(value) {
    let subdivisions = Math.floor(Number(value));

    if (!Number.isFinite(subdivisions) || subdivisions <= 0) {
        subdivisions = 2;
    }

    if (subdivisions > 3) {
        subdivisions = 3;
    }

    return subdivisions;
}

export function cleanMeshMethod(method) {
    let index = meshMethodIndex(method);

    if (index >= 0) {
        return meshMethodIds[index];
    }

    return defaultMeshMethod;
}

export function meshMethodLabel(method) {
    let index = meshMethodIndex(cleanMeshMethod(method));

    if (index >= 0) {
        return meshMethodLabels[index];
    }

    return "Contour fit";
}

export function meshMethodProgressStepCount(method) {
    let index = meshMethodIndex(cleanMeshMethod(method));

    if (index >= 0) {
        return meshMethodStepCounts[index];
    }

    return 8;
}

export function meshMethodUsesSubdivisions(method) {
    let index = meshMethodIndex(cleanMeshMethod(method));

    return index < 0 || meshMethodSubdivisionFlags[index] !== 0;
}

export function meshMetadataFromSource(source) {
    let metadata = {};

    copyMeshMetadata(metadata, source);

    return metadata;
}

export function copyMeshMetadata(target, source) {
    let index = 0;
    let field = "";

    if (!source) {
        return;
    }

    for (index = 0; index < meshMetadataFields.length; index += 1) {
        field = meshMetadataFields[index];

        if (typeof source[field] !== "undefined") {
            target[field] = source[field];
        }
    }
}

function meshMethodIndex(method) {
    let index = 0;

    for (index = 0; index < meshMethodIds.length; index += 1) {
        if (method === meshMethodIds[index]) {
            return index;
        }
    }

    return -1;
}
