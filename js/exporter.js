export function exportStlAscii(name, positions, progressFunc) {
    let solidName = cleanSolidName(name);
    let lines = [];
    let facet = createFacetWorkspace();
    let index = 0;
    let nextReportIndex = 0;

    lines.push("solid " + solidName);

    for (index = 0; index < positions.length; index += 9) {
        appendFacet(lines, positions, index, facet);

        if (index >= nextReportIndex) {
            reportExportProgress(progressFunc, index / positions.length);
            nextReportIndex += 9000;
        }
    }

    lines.push("endsolid " + solidName);
    reportExportProgress(progressFunc, 1.0);

    return lines.join("\n") + "\n";
}

export function exportStlBinary(name, positions, progressFunc) {
    let triangleCount = Math.floor(positions.length / 9);
    let buffer = new ArrayBuffer(84 + triangleCount * 50);
    let view = new DataView(buffer);
    let facet = createFacetWorkspace();
    let offset = 84;
    let index = 0;
    let nextReportIndex = 0;

    writeBinaryHeader(view, name);
    view.setUint32(80, triangleCount, true);

    for (index = 0; index < triangleCount * 9; index += 9) {
        offset = appendBinaryFacet(view, offset, positions, index, facet);

        if (index >= nextReportIndex) {
            reportExportProgress(progressFunc, index / positions.length);
            nextReportIndex += 9000;
        }
    }

    reportExportProgress(progressFunc, 1.0);

    return buffer;
}

export function downloadTextFile(filename, text, mimeType) {
    let blob = new Blob([text], {
        type: mimeType
    });

    downloadBlob(filename, blob);
}

export function downloadBinaryFile(filename, buffer, mimeType) {
    let blob = new Blob([buffer], {
        type: mimeType
    });

    downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
    let url = URL.createObjectURL(blob);
    let link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.setTimeout(function revokeDownloadUrl() {
        URL.revokeObjectURL(url);
    }, 1000);
}

function writeBinaryHeader(view, name) {
    let header = "SDFMake binary STL " + cleanSolidName(name);
    let index = 0;
    let value = 0;

    for (index = 0; index < 80; index += 1) {
        value = 0;

        if (index < header.length) {
            value = header.charCodeAt(index) & 127;
        }

        view.setUint8(index, value);
    }
}

function appendFacet(lines, positions, index, facet) {
    readFacet(positions, index, facet);

    lines.push("  facet normal " + formatNumber(facet.nx) + " " + formatNumber(facet.ny) + " " + formatNumber(facet.nz));
    lines.push("    outer loop");
    appendVertex(lines, facet.ax, facet.ay, facet.az);
    appendVertex(lines, facet.bx, facet.by, facet.bz);
    appendVertex(lines, facet.cx, facet.cy, facet.cz);
    lines.push("    endloop");
    lines.push("  endfacet");
}

function appendVertex(lines, x, y, z) {
    lines.push("      vertex " + formatNumber(x) + " " + formatNumber(y) + " " + formatNumber(z));
}

function appendBinaryFacet(view, offset, positions, index, facet) {
    readFacet(positions, index, facet);

    offset = writeBinaryFloat(view, offset, facet.nx);
    offset = writeBinaryFloat(view, offset, facet.ny);
    offset = writeBinaryFloat(view, offset, facet.nz);
    offset = appendBinaryVertex(view, offset, facet.ax, facet.ay, facet.az);
    offset = appendBinaryVertex(view, offset, facet.bx, facet.by, facet.bz);
    offset = appendBinaryVertex(view, offset, facet.cx, facet.cy, facet.cz);
    view.setUint16(offset, 0, true);

    return offset + 2;
}

function createFacetWorkspace() {
    return {
        ax: 0.0,
        ay: 0.0,
        az: 0.0,
        bx: 0.0,
        by: 0.0,
        bz: 0.0,
        cx: 0.0,
        cy: 0.0,
        cz: 0.0,
        nx: 0.0,
        ny: 0.0,
        nz: 0.0
    };
}

function readFacet(positions, index, facet) {
    let ux = 0.0;
    let uy = 0.0;
    let uz = 0.0;
    let vx = 0.0;
    let vy = 0.0;
    let vz = 0.0;
    let lengthValue = 0.0;

    facet.ax = positions[index];
    facet.ay = positions[index + 1];
    facet.az = positions[index + 2];
    facet.bx = positions[index + 3];
    facet.by = positions[index + 4];
    facet.bz = positions[index + 5];
    facet.cx = positions[index + 6];
    facet.cy = positions[index + 7];
    facet.cz = positions[index + 8];
    facet.nx = 0.0;
    facet.ny = 0.0;
    facet.nz = 0.0;
    ux = facet.bx - facet.ax;
    uy = facet.by - facet.ay;
    uz = facet.bz - facet.az;
    vx = facet.cx - facet.ax;
    vy = facet.cy - facet.ay;
    vz = facet.cz - facet.az;

    facet.nx = uy * vz - uz * vy;
    facet.ny = uz * vx - ux * vz;
    facet.nz = ux * vy - uy * vx;
    lengthValue = Math.hypot(facet.nx, facet.ny, facet.nz);

    if (lengthValue > 0.0000001) {
        facet.nx /= lengthValue;
        facet.ny /= lengthValue;
        facet.nz /= lengthValue;
    } else {
        facet.nx = 0.0;
        facet.ny = 0.0;
        facet.nz = 0.0;
    }
}

function appendBinaryVertex(view, offset, x, y, z) {
    offset = writeBinaryFloat(view, offset, x);
    offset = writeBinaryFloat(view, offset, y);
    offset = writeBinaryFloat(view, offset, z);

    return offset;
}

function writeBinaryFloat(view, offset, value) {
    let numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        numberValue = 0.0;
    }

    view.setFloat32(offset, numberValue, true);

    return offset + 4;
}

function reportExportProgress(progressFunc, progressValue) {
    if (!progressFunc) {
        return;
    }

    if (!Number.isFinite(progressValue)) {
        progressValue = 1.0;
    }

    if (progressValue < 0.0) {
        progressValue = 0.0;
    }

    if (progressValue > 1.0) {
        progressValue = 1.0;
    }

    progressFunc("Writing STL", progressValue);
}

function cleanSolidName(name) {
    let cleanName = String(name).replace(/[^a-zA-Z0-9_-]/g, "_");

    if (cleanName.length === 0) {
        cleanName = "sdfmake";
    }

    return cleanName;
}

function formatNumber(value) {
    let numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        numberValue = 0.0;
    }

    return numberValue.toFixed(6);
}
