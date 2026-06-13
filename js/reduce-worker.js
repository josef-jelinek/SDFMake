import { reduceMeshEdgeCollapse, reduceMeshStrongEdgeCollapse } from "./reducer.js";
import { copyMeshMetadata } from "./settings.js";

const edgeCollapseReducerMethod = "edge-collapse";
const strongEdgeCollapseReducerMethod = "strong-edge-collapse";
const edgeCollapseReducerLabel = "Edge collapse";
const strongEdgeCollapseReducerLabel = "Strong edge collapse";

self.addEventListener("message", onWorkerMessage);

function onWorkerMessage(event) {
    let message = event.data;

    if (!message || message.type !== "reduce") {
        return;
    }

    runReduction(message);
}

function runReduction(request) {
    let positions = new Float32Array(request.buffer);
    let reduced = null;
    let metadata = null;
    let reducerMethod = cleanReducerMethod(request.reducerMethod);
    let reducerLabel = reducerLabelForMethod(reducerMethod);

    postProgress("Starting " + reducerLabel + " mesh reduction", 0.0, 1, 1);

    try {
        if (reducerMethod === strongEdgeCollapseReducerMethod) {
            reduced = reduceMeshStrongEdgeCollapse(positions, postReduceProgress);
        } else {
            reduced = reduceMeshEdgeCollapse(positions, postReduceProgress);
        }
    } catch (error) {
        postError("Mesh reduction failed: " + error.message, []);
        return;
    }

    if (reduced.triangleCount <= 0) {
        postError("Mesh reduction produced no triangles.", []);
        return;
    }

    metadata = buildReducedMetadata(request.metadata, reduced, reducerMethod, reducerLabel);

    self.postMessage({
        type: "complete",
        buffer: reduced.positions.buffer,
        metadata: metadata
    }, [reduced.positions.buffer]);
}

function cleanReducerMethod(value) {
    if (value === strongEdgeCollapseReducerMethod) {
        return strongEdgeCollapseReducerMethod;
    }

    return edgeCollapseReducerMethod;
}

function reducerLabelForMethod(method) {
    if (method === strongEdgeCollapseReducerMethod) {
        return strongEdgeCollapseReducerLabel;
    }

    return edgeCollapseReducerLabel;
}

function buildReducedMetadata(sourceMetadata, reduced, reducerMethod, reducerLabel) {
    let metadata = {};

    copyMeshMetadata(metadata, sourceMetadata);

    metadata.reducerMethod = reducerMethod;
    metadata.reducerMethodLabel = reducerLabel;
    metadata.triangleCount = reduced.triangleCount;
    metadata.reductionSourceTriangleCount = reduced.originalTriangleCount;
    metadata.reductionOriginalBadEdgeCount = reduced.originalBadEdgeCount;
    metadata.reductionFinalBadEdgeCount = reduced.finalBadEdgeCount;
    metadata.reductionFinalGuardRejected = reduced.finalGuardRejected;
    metadata.reductionFallbackApplied = reduced.fallbackApplied;
    metadata.reductionApplied = !reduced.fallbackApplied;

    if (reduced.fallbackApplied) {
        return metadata;
    }

    if (!metadata.methodLabel) {
        metadata.methodLabel = "Reduced mesh";
    } else if (metadata.methodLabel.toLowerCase().indexOf("reduc") < 0) {
        metadata.methodLabel += " + reduction";
    }

    return metadata;
}

function postReduceProgress(label, progressValue, stepIndex, stepCount) {
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
