import { compileSdfFunction, parseScript } from "./compiler.js";
import { buildMesh } from "./mesh.js";
import { meshMetadataFromSource, meshMethodProgressStepCount } from "./settings.js";

let currentMeshProgressStepCount = 0;

self.addEventListener("message", onWorkerMessage);

function onWorkerMessage(event) {
    let message = event.data;

    if (!message || message.type !== "triangulate") {
        return;
    }

    runTriangulation(message);
}

function runTriangulation(request) {
    let parsed = null;
    let compiledSampler = null;
    let mesh = null;
    let metadata = null;
    let sampleSdf = null;
    let totalStepCount = 0;

    currentMeshProgressStepCount = meshMethodProgressStepCount(request.method);
    totalStepCount = 2 + currentMeshProgressStepCount;

    postProgress("Parsing script", 0.0, 1, totalStepCount);
    parsed = parseScript(request.script);

    if (!parsed.ok) {
        postError("Script error.", parsed.errors);
        return;
    }

    postProgress("Parsing script", 1.0, 1, totalStepCount);
    postProgress("Compiling script", 0.0, 2, totalStepCount);
    compiledSampler = compileSdfFunction(parsed, request.bound);

    if (!compiledSampler.ok) {
        postError("Compile error.", compiledSampler.errors);
        return;
    }

    sampleSdf = compiledSampler.sample;
    postProgress("Compiling script", 1.0, 2, totalStepCount);

    try {
        mesh = buildMesh(
            sampleSdf,
            request.resolution,
            request.bound,
            request.method,
            postMeshProgress,
            request.subdivisions
        );
    } catch (error) {
        postError("Triangulation failed: " + error.message, []);
        return;
    }

    if (mesh.triangleCount <= 0) {
        postError("Triangulation produced no triangles. Increase the volume size or check the script.", []);
        return;
    }

    metadata = meshMetadataFromSource(mesh);

    self.postMessage({
        type: "complete",
        buffer: mesh.positions.buffer,
        metadata: metadata
    }, [mesh.positions.buffer]);
}

function postMeshProgress(label, progressValue, meshStepIndex, meshStepCount) {
    let stepIndex = 3;
    let stepCount = 2 + currentMeshProgressStepCount;

    if (Number.isFinite(meshStepIndex)) {
        stepIndex = 2 + Math.floor(meshStepIndex);
    }

    if (Number.isFinite(meshStepCount)) {
        stepCount = 2 + Math.floor(meshStepCount);
    }

    postProgress(label, progressValue, stepIndex, stepCount);
}

function postProgress(label, progressValue, stepIndex, stepCount) {
    self.postMessage({
        type: "progress",
        label: label,
        progress: progressValue,
        stepIndex: stepIndex,
        stepCount: stepCount
    });
}

function postError(message, errors) {
    self.postMessage({
        type: "error",
        message: message,
        errors: errors
    });
}
