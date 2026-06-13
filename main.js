import { compileScene, defaultScript, parseScript } from "./js/compiler.js";
import { downloadBinaryFile, downloadTextFile, exportStlAscii, exportStlBinary } from "./js/exporter.js";
import { cleanMeshMethod, cleanSubdivisionsValue, meshMethodUsesSubdivisions } from "./js/settings.js";

const triangulationPadding = 1.0;
const cameraPitchLimit = Math.PI * 0.5;
const cameraDragScale = 0.006;
const cameraAnimateYawSpeed = 0.00012;
const sdfCompilePollIntervalMs = 200.0;
const reducerProgressStepCount = 10;
const meshModeWireframe = 0;
const meshModeTriangles = 1;
const meshModeShaded = 2;
const meshModeGrid = 3;
const meshWireEdgeOffsets = new Int8Array([0, 3, 3, 6, 6, 0]);

const app = {
    canvas: null,
    gl: null,
    scriptSource: null,
    statusMessage: null,
    previewModeInputs: null,
    meshMethodInputs: null,
    meshReducerInputs: null,
    meshCellSize: null,
    meshSubdivisions: null,
    meshBound: null,
    darkModeToggle: null,
    animateToggle: null,
    triangulateButton: null,
    exportButton: null,
    binaryExportButton: null,
    helpDialog: null,
    previewOverlay: null,
    previewOverlayMessage: null,
    previewOverlayProgress: null,
    previewOverlayStep: null,
    vertexSource: "",
    fragmentTemplate: "",
    meshVertexSource: "",
    meshFragmentSource: "",
    meshGBufferFragmentSource: "",
    meshAoFragmentSource: "",
    meshAoBlurFragmentSource: "",
    skyFragmentSource: "",
    program: null,
    meshProgram: null,
    meshGBufferProgram: null,
    meshAoProgram: null,
    meshAoBlurProgram: null,
    skyProgram: null,
    parallelShaderCompileExtension: null,
    sdfCompileJob: null,
    sdfCompilePending: null,
    sdfCompileStartQueued: false,
    sdfCompileDirty: false,
    sdfCompileLastPollTime: 0.0,
    sdfSceneSource: "",
    sdfSceneVersion: 0,
    sdfPrimitiveCount: 0,
    sdfBackgroundMode: "sdf-photo",
    programVersion: 0,
    photoProgram: null,
    photoProgramVersion: 0,
    positionBuffer: null,
    gridPlaneBuffer: null,
    gridPlaneVertexCount: 0,
    meshAoFramebuffer: null,
    meshAoMaskFramebuffer: null,
    meshAoNormalTexture: null,
    meshAoDepthTexture: null,
    meshAoMaskTexture: null,
    meshAoWidth: 0,
    meshAoHeight: 0,
    meshAoWarningShown: false,
    meshPositionBuffer: null,
    meshColorBuffer: null,
    meshNormalBuffer: null,
    meshWireBuffer: null,
    locations: null,
    meshLocations: null,
    meshGBufferLocations: null,
    meshAoLocations: null,
    meshAoBlurLocations: null,
    skyLocations: null,
    photoLocations: null,
    compileTimer: 0,
    yaw: 0.75,
    pitch: 0.35,
    cameraDistance: 135.0,
    cameraTargetX: 0.0,
    cameraTargetY: 0.0,
    cameraTargetZ: 25.0,
    dragging: false,
    lastPointerX: 0,
    lastPointerY: 0,
    lastFrameTime: 0.0,
    needsRender: false,
    triangulateWorker: null,
    triangulateSource: "",
    triangulateReducerMethod: "",
    meshReductionWorker: null,
    meshReductionSource: "",
    meshPositions: null,
    meshMetadata: null,
    meshTriangleVertexCount: 0,
    meshWireVertexCount: 0,
    meshSource: "",
    triangulationProgressStepCount: 0,
    previewProgressLabel: "",
    previewProgressStepText: "",
    previewProgressValue: 0.0,
    previewOverlayError: ""
};

window.addEventListener("load", init);

function init() {
    app.canvas = document.getElementById("preview-canvas");
    app.scriptSource = document.getElementById("script-source");
    app.statusMessage = document.getElementById("status-message");
    app.previewModeInputs = document.getElementsByName("preview-mode");
    app.meshMethodInputs = document.getElementsByName("mesh-method");
    app.meshReducerInputs = document.getElementsByName("mesh-reducer");
    app.meshCellSize = document.getElementById("mesh-cell-size");
    app.meshSubdivisions = document.getElementById("mesh-subdivisions");
    app.meshBound = document.getElementById("mesh-bound");
    app.darkModeToggle = document.getElementById("dark-mode-toggle");
    app.animateToggle = document.getElementById("animate-toggle");
    app.triangulateButton = document.getElementById("triangulate-button");
    app.exportButton = document.getElementById("export-button");
    app.binaryExportButton = document.getElementById("binary-export-button");
    app.helpDialog = document.getElementById("help-dialog");
    app.previewOverlay = document.getElementById("preview-overlay");
    app.previewOverlayMessage = document.getElementById("preview-overlay-message");
    app.previewOverlayProgress = document.getElementById("preview-overlay-progress");
    app.previewOverlayStep = document.getElementById("preview-overlay-step");
    app.scriptSource.value = defaultScript();
    app.gl = app.canvas.getContext("webgl2");

    restoreTheme();
    bindEvents();
    syncSubdivisionInput();

    if (!app.gl) {
        setStatus("WebGL2 is not available in this browser.");
        return;
    }

    app.parallelShaderCompileExtension = app.gl.getExtension("KHR_parallel_shader_compile");
    setupQuad();
    setupGridPlane();
    loadTextFiles([
        "glsl/render.vert.glsl",
        "glsl/render.frag.glsl",
        "glsl/mesh.vert.glsl",
        "glsl/mesh.frag.glsl",
        "glsl/mesh-gbuffer.frag.glsl",
        "glsl/mesh-ao.frag.glsl",
        "glsl/mesh-ao-blur.frag.glsl",
        "glsl/sky.frag.glsl"
    ], onShaderFilesLoaded);
    setStlButtonsEnabled(false);
    requestAnimationFrame(renderFrame);
}

function bindEvents() {
    let index = 0;

    app.triangulateButton.addEventListener("click", onTriangulateClick);
    app.exportButton.addEventListener("click", onExportClick);
    app.binaryExportButton.addEventListener("click", onBinaryExportClick);
    document.getElementById("help-button").addEventListener("click", onHelpClick);
    app.scriptSource.addEventListener("input", onScriptInput);

    for (index = 0; index < app.previewModeInputs.length; index += 1) {
        app.previewModeInputs[index].addEventListener("change", onPreviewModeChange);
    }

    for (index = 0; index < app.meshMethodInputs.length; index += 1) {
        app.meshMethodInputs[index].addEventListener("change", onMeshSettingsChange);
    }

    for (index = 0; index < app.meshReducerInputs.length; index += 1) {
        app.meshReducerInputs[index].addEventListener("change", onMeshSettingsChange);
    }

    app.meshCellSize.addEventListener("change", onMeshSettingsChange);
    app.meshSubdivisions.addEventListener("change", onMeshSettingsChange);
    app.meshBound.addEventListener("change", onMeshSettingsChange);
    app.darkModeToggle.addEventListener("change", onDarkModeToggleChange);
    app.animateToggle.addEventListener("change", onAnimateToggleChange);
    app.canvas.addEventListener("pointerdown", onPointerDown);
    app.canvas.addEventListener("pointermove", onPointerMove);
    app.canvas.addEventListener("pointerup", onPointerUp);
    app.canvas.addEventListener("pointercancel", onPointerUp);
    app.canvas.addEventListener("wheel", onWheel);
    app.previewOverlay.addEventListener("click", onPreviewOverlayClick);
    window.addEventListener("resize", onWindowResize);
}

function onShaderFilesLoaded(ok, texts, errors) {
    if (!ok) {
        setStatus(formatErrors("Could not load shaders.", errors));
        return;
    }

    app.vertexSource = texts[0];
    app.fragmentTemplate = texts[1];
    app.meshVertexSource = texts[2];
    app.meshFragmentSource = texts[3];
    app.meshGBufferFragmentSource = texts[4];
    app.meshAoFragmentSource = texts[5];
    app.meshAoBlurFragmentSource = texts[6];
    app.skyFragmentSource = texts[7];

    if (!setupStaticProgram("meshProgram", "meshLocations", app.meshVertexSource, app.meshFragmentSource, getMeshLocations)) {
        return;
    }

    if (!setupStaticProgram("meshGBufferProgram", "meshGBufferLocations", app.meshVertexSource, app.meshGBufferFragmentSource, getMeshGBufferLocations)) {
        return;
    }

    if (!setupStaticProgram("meshAoProgram", "meshAoLocations", app.vertexSource, app.meshAoFragmentSource, getMeshAoLocations)) {
        return;
    }

    if (!setupStaticProgram("meshAoBlurProgram", "meshAoBlurLocations", app.vertexSource, app.meshAoBlurFragmentSource, getMeshAoBlurLocations)) {
        return;
    }

    if (!setupStaticProgram("skyProgram", "skyLocations", app.vertexSource, app.skyFragmentSource, getSkyLocations)) {
        return;
    }

    compileCurrentScript();
}

function onTriangulateClick() {
    let previewMode = getPreviewModeValue();

    if (!previewModeRequiresMesh(previewMode)) {
        app.sdfBackgroundMode = cleanSdfMode(previewMode);
        setPreviewModeValue("shaded");
    }

    app.needsRender = true;
    startTriangulation();
}

function onExportClick() {
    saveCachedMesh("ascii");
}

function onBinaryExportClick() {
    saveCachedMesh("binary");
}

function onPreviewModeChange() {
    updatePreviewOverlay();
    if (!previewModeRequiresMesh(getPreviewModeValue())) {
        requestSdfProgramForMode(getNeededSdfMode());
    }
    app.needsRender = true;
}

function onMeshSettingsChange() {
    syncSubdivisionInput();
    clearTriangulation(false);
    updatePreviewOverlay();
}

function onHelpClick() {
    if (app.helpDialog.showModal) {
        app.helpDialog.showModal();
    } else {
        app.helpDialog.setAttribute("open", "");
    }
}

function onDarkModeToggleChange() {
    if (app.darkModeToggle.checked) {
        setTheme("dark", true);
    } else {
        setTheme("light", true);
    }
}

function restoreTheme() {
    let theme = readStoredTheme();

    if (theme !== "dark" && theme !== "light") {
        theme = "light";
    }

    setTheme(theme, false);
}

function setTheme(theme, storeTheme) {
    let cleanTheme = theme;

    if (cleanTheme !== "dark" && cleanTheme !== "light") {
        cleanTheme = "light";
    }

    document.documentElement.setAttribute("data-theme", cleanTheme);

    if (app.darkModeToggle) {
        app.darkModeToggle.checked = cleanTheme === "dark";
    }

    if (storeTheme) {
        writeStoredTheme(cleanTheme);
    }
}

function readStoredTheme() {
    try {
        return window.localStorage.getItem("sdfmake-theme");
    } catch (error) {
        return "";
    }
}

function writeStoredTheme(theme) {
    try {
        window.localStorage.setItem("sdfmake-theme", theme);
    } catch (error) {
    }
}

function onScriptInput() {
    if (app.compileTimer !== 0) {
        window.clearTimeout(app.compileTimer);
    }

    app.compileTimer = window.setTimeout(onCompileTimer, 160);
}

function onCompileTimer() {
    app.compileTimer = 0;
    compileCurrentScript();
}

function onPointerDown(event) {
    if (previewMeshPromptIsVisible()) {
        startTriangulation();
        event.preventDefault();
        return;
    }

    app.dragging = true;
    app.lastPointerX = event.clientX;
    app.lastPointerY = event.clientY;
    app.canvas.setPointerCapture(event.pointerId);
}

function onPreviewOverlayClick(event) {
    if (previewMeshPromptIsVisible()) {
        startTriangulation();
        event.preventDefault();
    }
}

function onPointerMove(event) {
    let dx = 0.0;
    let dy = 0.0;

    if (!app.dragging) {
        return;
    }

    dx = event.clientX - app.lastPointerX;
    dy = event.clientY - app.lastPointerY;
    app.lastPointerX = event.clientX;
    app.lastPointerY = event.clientY;
    app.yaw -= dx * cameraDragScale;
    app.pitch += dy * cameraDragScale;
    app.pitch = Math.min(Math.max(app.pitch, -cameraPitchLimit), cameraPitchLimit);
    app.needsRender = true;
    event.preventDefault();
}

function onPointerUp(event) {
    app.dragging = false;

    if (app.canvas.hasPointerCapture(event.pointerId)) {
        app.canvas.releasePointerCapture(event.pointerId);
    }
}

function onWheel(event) {
    let factor = 1.0 + Math.abs(event.deltaY) * 0.001;

    if (event.deltaY > 0.0) {
        app.cameraDistance *= factor;
    } else {
        app.cameraDistance /= factor;
    }

    app.cameraDistance = Math.min(Math.max(app.cameraDistance, 25.0), 500.0);
    app.needsRender = true;
    event.preventDefault();
}

function onWindowResize() {
    app.needsRender = true;
}

function onAnimateToggleChange() {
    app.lastFrameTime = 0.0;
    app.needsRender = true;
}

function compileCurrentScript() {
    let scriptSource = app.scriptSource.value;
    let parsed = parseScript(scriptSource);
    let compiled = null;
    let hadCompileJob = app.sdfCompileJob !== null;

    if (app.meshSource !== "" && app.meshSource !== scriptSource) {
        clearTriangulation(false);
    }

    if (!parsed.ok) {
        app.sdfSceneSource = "";
        app.sdfCompilePending = null;
        app.sdfCompileDirty = hadCompileJob;
        setStatus(formatErrors("Script error.", parsed.errors));
        return;
    }

    compiled = compileScene(parsed);

    if (!compiled.ok) {
        app.sdfSceneSource = "";
        app.sdfCompilePending = null;
        app.sdfCompileDirty = hadCompileJob;
        setStatus(formatErrors("Compile error.", compiled.errors));
        return;
    }

    if (app.fragmentTemplate.length === 0) {
        setStatus("Shaders are still loading.");
        return;
    }

    app.sdfSceneSource = compiled.source;
    app.sdfPrimitiveCount = compiled.primitiveCount;
    app.sdfSceneVersion += 1;

    if (hadCompileJob) {
        app.sdfCompileDirty = true;
        setStatus("Compiling shader. Latest script change queued.");
        return;
    }

    requestSdfProgramForMode(getNeededSdfMode());
}

function startTriangulation() {
    let method = getMeshMethodValue();
    let reducerMethod = getMeshReducerValue();
    let cellSize = cleanExportCellSize(app.meshCellSize.value);
    let subdivisions = cleanSubdivisionsValue(app.meshSubdivisions.value);
    let resolution = 0;
    let volumeSize = cleanExportVolumeSize(app.meshBound.value);
    let triangulationBounds = null;

    if (meshOperationIsBusy()) {
        return;
    }

    clearTriangulation(false);
    triangulationBounds = createTriangulationBounds(volumeSize, cellSize);
    resolution = triangulationBounds.resolution;
    app.meshCellSize.value = formatDisplayNumber(cellSize);
    app.meshSubdivisions.value = String(subdivisions);
    app.meshBound.value = formatDisplayNumber(volumeSize);

    app.triangulateWorker = createMeshWorker("js/export-worker.js", onTriangulateWorkerMessage, onTriangulateWorkerError, "Triangulation failed");

    if (!app.triangulateWorker) {
        return;
    }

    app.triangulateSource = app.scriptSource.value;
    app.triangulateReducerMethod = reducerMethod;
    app.triangulationProgressStepCount = 0;
    app.previewProgressLabel = "Starting triangulation";
    app.previewProgressStepText = "";
    app.previewProgressValue = 0.0;
    setMeshOperationControlsBusy(true);
    setStlButtonsEnabled(false);
    setTriangulationProgressStatus("Starting triangulation", 0.0, 1, 1);
    updatePreviewOverlay();
    app.needsRender = true;
    app.triangulateWorker.postMessage({
        type: "triangulate",
        script: app.triangulateSource,
        method: method,
        bound: triangulationBounds,
        cellSize: cellSize,
        subdivisions: subdivisions,
        resolution: resolution
    });
}

function onTriangulateWorkerMessage(event) {
    let message = event.data;

    if (!message) {
        return;
    }

    if (message.type === "progress") {
        setTriangulationProgressStatus(message.label, message.progress, message.stepIndex, message.stepCount);
        return;
    }

    if (message.type === "error") {
        app.previewOverlayError = formatErrors(message.message, message.errors);
        finishMeshWorker("triangulateWorker");
        app.triangulateSource = "";
        app.triangulateReducerMethod = "";
        setStatus(app.previewOverlayError);
        app.needsRender = true;
        return;
    }

    if (message.type === "complete") {
        finishMeshWorker("triangulateWorker");
        acceptTriangulationResult(message);
    }
}

function onTriangulateWorkerError(event) {
    app.previewOverlayError = "Triangulation failed: " + event.message;
    finishMeshWorker("triangulateWorker");
    app.triangulateSource = "";
    app.triangulateReducerMethod = "";
    setStatus(app.previewOverlayError);
    app.needsRender = true;
}

function acceptTriangulationResult(message) {
    let source = app.triangulateSource;
    let reducerMethod = app.triangulateReducerMethod;

    if (app.triangulateSource !== app.scriptSource.value) {
        app.triangulateSource = "";
        app.triangulateReducerMethod = "";
        clearTriangulation(false);
        setStatus("Triangulation discarded because the script changed.");
        return;
    }

    app.triangulateSource = "";
    app.triangulateReducerMethod = "";

    if (reducerMethod === "none") {
        acceptMeshResult(message.buffer, markUnreducedMetadata(message.metadata), source);
        return;
    }

    startReduction(message.buffer, message.metadata, source, reducerMethod);
}

function startReduction(buffer, metadata, source, reducerMethod) {
    if (meshOperationIsBusy()) {
        return;
    }

    app.meshReductionWorker = createMeshWorker("js/reduce-worker.js", onReduceWorkerMessage, onReduceWorkerError, "Mesh reduction failed");

    if (!app.meshReductionWorker) {
        return;
    }

    app.meshReductionSource = source;
    app.previewProgressLabel = "Starting mesh reduction";
    app.previewProgressStepText = "";
    app.previewProgressValue = 0.0;
    setMeshOperationControlsBusy(true);
    setReductionProgressStatus("Starting mesh reduction", 0.0, 1, reducerProgressStepCount);
    updatePreviewOverlay();
    app.needsRender = true;
    app.meshReductionWorker.postMessage({
        type: "reduce",
        buffer: buffer,
        metadata: metadata,
        reducerMethod: reducerMethod
    }, [buffer]);
}

function onReduceWorkerMessage(event) {
    let message = event.data;

    if (!message) {
        return;
    }

    if (message.type === "progress") {
        setReductionProgressStatus(message.label, message.progress, message.stepIndex, message.stepCount);
        return;
    }

    if (message.type === "error") {
        app.previewOverlayError = formatErrors(message.message, message.errors);
        finishMeshWorker("meshReductionWorker");
        app.meshReductionSource = "";
        setStatus(app.previewOverlayError);
        app.needsRender = true;
        return;
    }

    if (message.type === "complete") {
        finishMeshWorker("meshReductionWorker");
        acceptReductionResult(message);
    }
}

function onReduceWorkerError(event) {
    app.previewOverlayError = "Mesh reduction failed: " + event.message;
    finishMeshWorker("meshReductionWorker");
    app.meshReductionSource = "";
    setStatus(app.previewOverlayError);
    app.needsRender = true;
}

function acceptReductionResult(message) {
    if (app.meshReductionSource !== app.scriptSource.value) {
        app.meshReductionSource = "";
        clearTriangulation(false);
        setStatus("Triangulation discarded because the script changed.");
        return;
    }

    acceptMeshResult(message.buffer, message.metadata, app.meshReductionSource);
    app.meshReductionSource = "";
}

function meshOperationIsBusy() {
    if (app.triangulateWorker || app.meshReductionWorker) {
        setStatus("Triangulation already in progress.");
        return true;
    }

    return false;
}

function createMeshWorker(url, messageHandler, errorHandler, label) {
    let worker = null;

    try {
        worker = new Worker(url, {
            type: "module"
        });
    } catch (error) {
        app.previewOverlayError = label + ": could not start worker. " + error.message;
        setStatus(app.previewOverlayError);
        updatePreviewOverlay();
        return null;
    }

    worker.addEventListener("message", messageHandler);
    worker.addEventListener("error", errorHandler);

    return worker;
}

function acceptMeshResult(buffer, metadata, source) {
    app.meshPositions = new Float32Array(buffer);
    app.meshMetadata = metadata;
    app.meshSource = source;
    uploadMeshPreview(app.meshPositions);
    setStlButtonsEnabled(true);
    app.needsRender = true;
    updatePreviewOverlay();
    setTriangulationCompleteStatus("Triangulated", app.meshMetadata);
}

function markUnreducedMetadata(metadata) {
    metadata.reducerMethod = "none";
    metadata.reducerMethodLabel = "None";
    metadata.reductionApplied = false;

    return metadata;
}

function saveCachedMesh(format) {
    let fileData = null;

    if (!app.meshPositions || !app.meshMetadata) {
        setStatus("Triangulate the object before exporting STL.");
        return;
    }

    if (format === "binary") {
        fileData = exportStlBinary("sdfmake", app.meshPositions);
        downloadBinaryFile("sdfmake-binary.stl", fileData, "model/stl");
        setTriangulationCompleteStatus("Exported binary STL", app.meshMetadata);
        return;
    }

    fileData = exportStlAscii("sdfmake", app.meshPositions);
    downloadTextFile("sdfmake.stl", fileData, "model/stl");
    setTriangulationCompleteStatus("Exported ASCII STL", app.meshMetadata);
}

function finishMeshWorker(workerName) {
    if (app[workerName]) {
        app[workerName].terminate();
        app[workerName] = null;
    }

    setMeshOperationControlsBusy(false);
    app.previewProgressLabel = "";
    app.previewProgressStepText = "";
    app.previewProgressValue = 0.0;
    updatePreviewOverlay();
}

function setMeshOperationControlsBusy(busy) {
    let stlEnabled = !busy && app.meshPositions !== null;

    app.triangulateButton.disabled = busy;
    setInputListDisabled(app.meshMethodInputs, busy);
    setInputListDisabled(app.meshReducerInputs, busy);
    app.meshCellSize.disabled = busy;
    app.meshSubdivisions.disabled = busy || !meshMethodUsesSubdivisions(getMeshMethodValue());
    app.meshBound.disabled = busy;

    setStlButtonsEnabled(stlEnabled);
}

function setStlButtonsEnabled(enabled) {
    app.exportButton.disabled = !enabled;
    app.binaryExportButton.disabled = !enabled;
}

function setInputListDisabled(inputs, disabled) {
    let index = 0;

    if (!inputs) {
        return;
    }

    for (index = 0; index < inputs.length; index += 1) {
        inputs[index].disabled = disabled;
    }
}

function setTriangulationProgressStatus(label, progressValue, stepIndex, stepCount) {
    let cleanStepIndex = cleanProgressStepIndex(stepIndex);
    let cleanStepCount = cleanProgressStepCount(stepCount, cleanStepIndex);
    let displayStepCount = cleanStepCount;

    app.triangulationProgressStepCount = cleanStepCount;

    if (app.triangulateReducerMethod !== "none") {
        displayStepCount += reducerProgressStepCount;
    }

    app.previewProgressLabel = formatProgressLabel("Generating object mesh", label);
    app.previewProgressStepText = formatProgressStepText(cleanStepIndex, displayStepCount);
    app.previewProgressValue = Math.min(Math.max(progressValue, 0.0), 1.0);

    updatePreviewOverlay();
}

function setTriangulationCompleteStatus(prefix, mesh) {
    let text = prefix + ": " + mesh.triangleCount
        + " triangles at " + formatDisplayNumber(mesh.cellSize)
        + " mm cells (" + mesh.resolution
        + " cells per axis).";
    let reductionParts = buildReductionStatusParts(mesh);

    if (reductionParts.length > 0) {
        text += " Reducer: " + reductionParts.join(", ") + ".";
    }

    setStatus(text);
}

function buildReductionStatusParts(mesh) {
    let parts = [];

    if (mesh.reducerMethodLabel && mesh.reducerMethodLabel !== "None") {
        parts.push(mesh.reducerMethodLabel);
    }

    appendPositiveStatusCount(parts, mesh.reductionSourceTriangleCount, "original triangles");
    appendPositiveStatusCount(parts, mesh.reductionOriginalBadEdgeCount, "original bad edges");
    appendPositiveStatusCount(parts, mesh.reductionFinalBadEdgeCount, "resulting bad edges");

    if (mesh.reductionFinalGuardRejected) {
        parts.push("final guard rejected unsafe result");
    }

    return parts;
}

function appendPositiveStatusCount(parts, value, label) {
    let count = Math.floor(Number(value));

    if (Number.isFinite(count) && count > 0) {
        parts.push(count + " " + label);
    }
}

function setReductionProgressStatus(label, progressValue, stepIndex, stepCount) {
    let baseStepCount = app.triangulationProgressStepCount;
    let cleanStepIndex = cleanProgressStepIndex(stepIndex);
    let cleanStepCount = cleanProgressStepCount(stepCount, cleanStepIndex);
    let displayStepIndex = baseStepCount + cleanStepIndex;
    let displayStepCount = baseStepCount + cleanStepCount;

    if (baseStepCount <= 0) {
        displayStepIndex = cleanStepIndex;
        displayStepCount = cleanStepCount;
    }

    app.previewProgressLabel = formatProgressLabel("Reducing object mesh", label);
    app.previewProgressStepText = formatProgressStepText(displayStepIndex, displayStepCount);
    app.previewProgressValue = Math.min(Math.max(progressValue, 0.0), 1.0);

    updatePreviewOverlay();
}

function formatProgressLabel(prefix, label) {
    return prefix + ": " + label;
}

function formatProgressStepText(stepIndex, stepCount) {
    return stepIndex + "/" + stepCount;
}

function cleanProgressStepIndex(value) {
    let cleanValue = Math.floor(Number(value));

    if (!Number.isFinite(cleanValue) || cleanValue < 1) {
        return 1;
    }

    return cleanValue;
}

function cleanProgressStepCount(value, stepIndex) {
    let cleanValue = Math.floor(Number(value));

    if (!Number.isFinite(cleanValue) || cleanValue < stepIndex) {
        return stepIndex;
    }

    return cleanValue;
}

function clearTriangulation(updateStatus) {
    if (app.meshReductionWorker) {
        app.meshReductionWorker.terminate();
        app.meshReductionWorker = null;
        app.meshReductionSource = "";
        setMeshOperationControlsBusy(false);
    }

    app.meshPositions = null;
    app.meshMetadata = null;
    app.meshTriangleVertexCount = 0;
    app.meshWireVertexCount = 0;
    app.meshSource = "";
    app.triangulationProgressStepCount = 0;
    app.previewProgressLabel = "";
    app.previewProgressStepText = "";
    app.previewProgressValue = 0.0;
    app.previewOverlayError = "";
    setStlButtonsEnabled(false);
    updatePreviewOverlay();

    if (updateStatus) {
        setStatus("Triangulation cleared.");
    }

    app.needsRender = true;
}

function cleanExportCellSize(value) {
    let cellSize = Number(value);

    if (!Number.isFinite(cellSize) || cellSize <= 0.0) {
        cellSize = 1.0;
    }

    if (cellSize < 0.1) {
        cellSize = 0.1;
    }

    return cellSize;
}

function syncSubdivisionInput() {
    let cellSize = cleanExportCellSize(app.meshCellSize.value);
    let subdivisions = cleanSubdivisionsValue(app.meshSubdivisions.value);

    app.meshCellSize.value = formatDisplayNumber(cellSize);
    app.meshSubdivisions.value = String(subdivisions);
    app.meshSubdivisions.disabled = !meshMethodUsesSubdivisions(getMeshMethodValue());
}

function getPreviewModeValue() {
    let index = 0;

    if (!app.previewModeInputs) {
        return "sdf";
    }

    for (index = 0; index < app.previewModeInputs.length; index += 1) {
        if (app.previewModeInputs[index].checked) {
            return app.previewModeInputs[index].value;
        }
    }

    return "sdf";
}

function setPreviewModeValue(value) {
    let index = 0;

    if (!app.previewModeInputs) {
        return;
    }

    for (index = 0; index < app.previewModeInputs.length; index += 1) {
        app.previewModeInputs[index].checked = app.previewModeInputs[index].value === value;
    }

    updatePreviewOverlay();
}

function getNeededSdfMode() {
    let previewMode = getPreviewModeValue();

    if (previewModeRequiresMesh(previewMode)) {
        return getSdfBackgroundMode();
    }

    if (previewMode === "sdf-photo") {
        app.sdfBackgroundMode = "sdf-photo";
        return "sdf-photo";
    }

    app.sdfBackgroundMode = "sdf";
    return "sdf";
}

function getSdfBackgroundMode() {
    if (sdfProgramIsCurrent(app.sdfBackgroundMode)) {
        return app.sdfBackgroundMode;
    }

    if (sdfProgramIsCurrent("sdf-photo")) {
        app.sdfBackgroundMode = "sdf-photo";
        return "sdf-photo";
    }

    if (sdfProgramIsCurrent("sdf")) {
        app.sdfBackgroundMode = "sdf";
        return "sdf";
    }

    return app.sdfBackgroundMode;
}

function sdfModeIsPhoto(mode) {
    return mode === "sdf-photo";
}

function getMeshMethodValue() {
    let index = 0;

    if (!app.meshMethodInputs) {
        return cleanMeshMethod("");
    }

    for (index = 0; index < app.meshMethodInputs.length; index += 1) {
        if (app.meshMethodInputs[index].checked) {
            return cleanMeshMethod(app.meshMethodInputs[index].value);
        }
    }

    return cleanMeshMethod("");
}

function getMeshReducerValue() {
    let index = 0;

    if (!app.meshReducerInputs) {
        return "edge-collapse";
    }

    for (index = 0; index < app.meshReducerInputs.length; index += 1) {
        if (app.meshReducerInputs[index].checked) {
            return app.meshReducerInputs[index].value;
        }
    }

    return "edge-collapse";
}

function previewModeRequiresMesh(value) {
    return value === "shaded" || value === "wireframe" || value === "triangles";
}

function previewMeshPromptIsVisible() {
    return previewModeRequiresMesh(getPreviewModeValue())
        && !app.meshPositions
        && !app.triangulateWorker
        && !app.meshReductionWorker;
}

function updatePreviewOverlay() {
    let previewMode = getPreviewModeValue();
    let busy = false;
    let compilingScene = false;
    let waitingForMesh = false;
    let progressValue = 0.0;

    if (!app.previewOverlay || !app.previewOverlayMessage || !app.previewOverlayProgress || !app.previewOverlayStep || !app.canvas) {
        return;
    }

    busy = app.triangulateWorker !== null || app.meshReductionWorker !== null;
    compilingScene = sdfCompileOverlayIsVisible(previewMode);
    waitingForMesh = previewModeRequiresMesh(previewMode) && !app.meshPositions && !busy;

    if (!busy && !compilingScene && !waitingForMesh) {
        app.previewOverlay.hidden = true;
        app.previewOverlayProgress.hidden = true;
        app.previewOverlayStep.hidden = true;
        app.canvas.classList.remove("preview-grayscale");
        return;
    }

    app.previewOverlay.hidden = false;
    app.canvas.classList.add("preview-grayscale");

    if (busy) {
        progressValue = Math.min(Math.max(app.previewProgressValue, 0.0), 1.0);
        setPreviewOverlayMessage(app.previewProgressLabel, "", app.previewOverlayError);
        app.previewOverlayProgress.hidden = false;
        app.previewOverlayProgress.setAttribute("value", String(Math.round(progressValue * 100.0)));
        app.previewOverlayStep.textContent = app.previewProgressStepText;
        app.previewOverlayStep.hidden = app.previewProgressStepText === "";
        return;
    }

    if (compilingScene) {
        setPreviewOverlayMessage("Compiling scene...", "", "");
        app.previewOverlayProgress.hidden = true;
        app.previewOverlayStep.hidden = true;
        return;
    }

    setPreviewOverlayMessage("Mesh is not generated.", "Click to create the object mesh.", app.previewOverlayError);
    app.previewOverlayProgress.hidden = true;
    app.previewOverlayStep.hidden = true;
}

function sdfCompileOverlayIsVisible(previewMode) {
    let mode = "";

    if (previewModeRequiresMesh(previewMode) || (!app.sdfCompileJob && !app.sdfCompilePending)) {
        return false;
    }

    mode = cleanSdfMode(previewMode);
    return getSdfProgramVersion(mode) !== app.sdfSceneVersion;
}

function setPreviewOverlayMessage(message, strongMessage, errorMessage) {
    app.previewOverlayMessage.textContent = "";

    appendPreviewOverlayLine(message, false);
    appendPreviewOverlayLine(errorMessage, false);
    appendPreviewOverlayLine(strongMessage, true);
}

function appendPreviewOverlayLine(text, strong) {
    let element = null;

    if (text === "") {
        return;
    }

    if (strong) {
        element = document.createElement("strong");
    } else {
        element = document.createElement("span");
    }

    element.className = "preview-overlay-line";
    element.textContent = text;
    app.previewOverlayMessage.appendChild(element);
}

function cleanExportVolumeSize(value) {
    let volumeSize = Number(value);

    if (!Number.isFinite(volumeSize) || volumeSize <= 0.0) {
        volumeSize = 120.0;
    }

    if (volumeSize < 10.0) {
        volumeSize = 10.0;
    }

    if (volumeSize > 500.0) {
        volumeSize = 500.0;
    }

    return volumeSize;
}

function createTriangulationBounds(volumeSize, cellSize) {
    let cleanCellSize = cleanExportCellSize(cellSize);
    let cellCount = exportResolutionFromCellSize(volumeSize, cleanCellSize);
    let halfCellCount = cellCount / 2.0;
    let negativeZCellCount = Math.ceil(triangulationPadding / cleanCellSize);
    let alignedSize = cellCount * cleanCellSize;

    if (!Number.isFinite(negativeZCellCount) || negativeZCellCount < 0) {
        negativeZCellCount = 0;
    }

    return {
        minX: -halfCellCount * cleanCellSize,
        minY: -halfCellCount * cleanCellSize,
        minZ: -negativeZCellCount * cleanCellSize,
        size: alignedSize,
        bound: volumeSize,
        padding: triangulationPadding,
        resolution: cellCount
    };
}

function formatDisplayNumber(value) {
    let text = "";

    if (!Number.isFinite(value)) {
        return "0";
    }

    text = value.toFixed(6);
    text = text.replace(/0+$/g, "");

    if (text.charAt(text.length - 1) === ".") {
        text = text.slice(0, text.length - 1);
    }

    return text;
}

function exportResolutionFromCellSize(volumeSize, cellSize) {
    let cleanCellSize = cleanExportCellSize(cellSize);
    let halfWidthCellCount = Math.ceil((volumeSize * 0.5 + triangulationPadding) / cleanCellSize);
    let negativeZCellCount = Math.ceil(triangulationPadding / cleanCellSize);
    let positiveZCellCount = Math.ceil((volumeSize + triangulationPadding) / cleanCellSize);
    let resolution = Math.max(halfWidthCellCount * 2, negativeZCellCount + positiveZCellCount);

    if (!Number.isFinite(resolution)) {
        resolution = 4;
    }

    if (resolution < 4) {
        resolution = 4;
    }

    if (resolution % 2 !== 0) {
        resolution += 1;
    }

    return resolution;
}

function renderFrame(time) {
    requestAnimationFrame(renderFrame);
    pollSdfProgramCompilation(time);
    updateAnimatedCamera(time);

    if (!app.needsRender) {
        return;
    }

    app.needsRender = false;
    renderScene();
}

function updateAnimatedCamera(time) {
    let delta = 0.0;

    if (!app.animateToggle || !app.animateToggle.checked) {
        app.lastFrameTime = time;
        return;
    }

    if (app.lastFrameTime > 0.0) {
        delta = time - app.lastFrameTime;
    }

    app.lastFrameTime = time;

    if (delta <= 0.0 || delta > 1000.0) {
        return;
    }

    app.yaw += delta * cameraAnimateYawSpeed;
    app.needsRender = true;
}

function renderScene() {
    let previewMode = getPreviewModeValue();

    updatePreviewOverlay();

    if (previewModeRequiresMesh(previewMode)) {
        if (!app.meshPositions) {
            renderSdfScene(false, sdfModeIsPhoto(getSdfBackgroundMode()));
            return;
        }

        if (previewMode === "wireframe") {
            renderMeshScene("wireframe");
            return;
        }

        if (previewMode === "triangles") {
            renderMeshScene("triangles");
            return;
        }

        renderMeshScene("shaded");
        return;
    }

    if (previewMode === "sdf-photo") {
        renderSdfScene(false, true);
        return;
    }

    renderSdfScene(true, false);
}

function renderSdfScene(showBounds, photoMode) {
    let gl = app.gl;
    let camera = null;
    let mode = "sdf";
    let program = null;
    let locations = null;

    if (photoMode) {
        mode = "sdf-photo";
    }

    if (!previewModeRequiresMesh(getPreviewModeValue())) {
        app.sdfBackgroundMode = mode;
    }

    program = getSdfProgram(mode);
    locations = getSdfLocations(mode);

    if (!gl || !program || !locations) {
        requestSdfProgramForMode(mode);
        return;
    }

    if (getSdfProgramVersion(mode) !== app.sdfSceneVersion) {
        requestSdfProgramForMode(mode);
    }

    resizeCanvas();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, app.canvas.width, app.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.positionBuffer);
    gl.enableVertexAttribArray(locations.aPosition);
    gl.vertexAttribPointer(locations.aPosition, 2, gl.FLOAT, false, 0, 0);

    camera = getCameraPosition();
    gl.uniform2f(locations.uResolution, app.canvas.width, app.canvas.height);
    gl.uniform3f(locations.uCameraPosition, camera.x, camera.y, camera.z);
    gl.uniform3f(locations.uCameraTarget, app.cameraTargetX, app.cameraTargetY, app.cameraTargetZ);
    gl.uniform3f(locations.uCameraRight, camera.rightX, camera.rightY, camera.rightZ);
    gl.uniform3f(locations.uCameraUp, camera.upX, camera.upY, camera.upZ);
    gl.uniform1f(locations.uBoundsSize, cleanExportVolumeSize(app.meshBound.value));
    if (showBounds) {
        gl.uniform1f(locations.uShowBoundsWire, 1.0);
    } else {
        gl.uniform1f(locations.uShowBoundsWire, 0.0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function renderMeshScene(mode) {
    let gl = app.gl;
    let matrix = null;
    let inverseMatrix = null;
    let camera = null;
    let hasAoMask = false;

    if (!gl || !app.meshProgram || !app.meshPositions) {
        return;
    }

    resizeCanvas();
    camera = getCameraPosition();
    matrix = buildViewProjectionMatrix(camera);

    if (mode === "shaded" || mode === "triangles") {
        hasAoMask = renderMeshAoGBuffer(matrix, camera);

        if (hasAoMask) {
            inverseMatrix = buildInverseViewProjectionMatrix(camera);
            hasAoMask = renderMeshAoMaskTexture(matrix, inverseMatrix, camera);
        }
    }

    renderMeshForwardScene(mode, matrix, camera);

    if (hasAoMask) {
        renderMeshAoBlurOverlay();
    }
}

function renderMeshForwardScene(mode, matrix, camera) {
    let gl = app.gl;
    let meshMode = 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, app.canvas.width, app.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    renderSkyBackground(camera);
    renderMeshGridPlane(matrix, camera, false);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(app.meshProgram);
    gl.uniformMatrix4fv(app.meshLocations.uMatrix, false, matrix);
    gl.uniform3f(app.meshLocations.uCameraPosition, camera.x, camera.y, camera.z);
    gl.uniform1f(app.meshLocations.uAlpha, 1.0);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.meshPositionBuffer);
    gl.enableVertexAttribArray(app.meshLocations.aPosition);
    gl.vertexAttribPointer(app.meshLocations.aPosition, 3, gl.FLOAT, false, 0, 0);

    if (mode === "wireframe") {
        gl.uniform1i(app.meshLocations.uMeshMode, meshModeWireframe);
        gl.bindBuffer(gl.ARRAY_BUFFER, app.meshWireBuffer);
        gl.vertexAttribPointer(app.meshLocations.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(app.meshLocations.aColor);
        gl.disableVertexAttribArray(app.meshLocations.aNormal);
        gl.vertexAttrib3f(app.meshLocations.aColor, 0.02, 0.02, 0.02);
        gl.vertexAttrib3f(app.meshLocations.aNormal, 0.0, 0.0, 1.0);
        gl.drawArrays(gl.LINES, 0, app.meshWireVertexCount);
        return;
    }

    meshMode = meshModeTriangles;

    if (mode === "shaded") {
        meshMode = meshModeShaded;
    }

    gl.uniform1i(app.meshLocations.uMeshMode, meshMode);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.meshColorBuffer);
    gl.enableVertexAttribArray(app.meshLocations.aColor);
    gl.vertexAttribPointer(app.meshLocations.aColor, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.meshNormalBuffer);
    gl.enableVertexAttribArray(app.meshLocations.aNormal);
    gl.vertexAttribPointer(app.meshLocations.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, app.meshTriangleVertexCount);
}

function renderMeshAoGBuffer(matrix, camera) {
    let gl = app.gl;

    if (!app.meshGBufferProgram || !app.meshAoProgram || !ensureMeshAoFramebuffer()) {
        return false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, app.meshAoFramebuffer);
    gl.viewport(0, 0, app.canvas.width, app.canvas.height);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.useProgram(app.meshGBufferProgram);
    gl.uniformMatrix4fv(app.meshGBufferLocations.uMatrix, false, matrix);
    gl.uniform3f(app.meshGBufferLocations.uCameraPosition, camera.x, camera.y, camera.z);

    renderMeshAoGBufferGridPlane();
    renderMeshAoGBufferObject();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawBuffers([gl.BACK]);

    return true;
}

function renderMeshAoGBufferGridPlane() {
    let gl = app.gl;

    gl.uniform1i(app.meshGBufferLocations.uMeshMode, meshModeGrid);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.gridPlaneBuffer);
    gl.enableVertexAttribArray(app.meshGBufferLocations.aPosition);
    gl.vertexAttribPointer(app.meshGBufferLocations.aPosition, 3, gl.FLOAT, false, 0, 0);

    if (app.meshGBufferLocations.aNormal >= 0) {
        gl.disableVertexAttribArray(app.meshGBufferLocations.aNormal);
        gl.vertexAttrib3f(app.meshGBufferLocations.aNormal, 0.0, 0.0, 1.0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, app.gridPlaneVertexCount);
}

function renderMeshAoGBufferObject() {
    let gl = app.gl;

    gl.uniform1i(app.meshGBufferLocations.uMeshMode, meshModeShaded);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.meshPositionBuffer);
    gl.enableVertexAttribArray(app.meshGBufferLocations.aPosition);
    gl.vertexAttribPointer(app.meshGBufferLocations.aPosition, 3, gl.FLOAT, false, 0, 0);

    if (app.meshGBufferLocations.aNormal >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, app.meshNormalBuffer);
        gl.enableVertexAttribArray(app.meshGBufferLocations.aNormal);
        gl.vertexAttribPointer(app.meshGBufferLocations.aNormal, 3, gl.FLOAT, false, 0, 0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, app.meshTriangleVertexCount);
}

function renderMeshAoMaskTexture(matrix, inverseMatrix, camera) {
    let gl = app.gl;

    if (!app.meshAoProgram || !app.meshAoMaskFramebuffer || !app.meshAoMaskTexture) {
        return false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, app.meshAoMaskFramebuffer);
    gl.viewport(0, 0, app.canvas.width, app.canvas.height);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.useProgram(app.meshAoProgram);
    gl.uniform2f(app.meshAoLocations.uResolution, app.canvas.width, app.canvas.height);
    gl.uniformMatrix4fv(app.meshAoLocations.uMatrix, false, matrix);
    gl.uniformMatrix4fv(app.meshAoLocations.uInverseMatrix, false, inverseMatrix);
    gl.uniform3f(app.meshAoLocations.uCameraPosition, camera.x, camera.y, camera.z);
    gl.uniform1f(app.meshAoLocations.uBoundsSize, cleanExportVolumeSize(app.meshBound.value));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, app.meshAoNormalTexture);
    gl.uniform1i(app.meshAoLocations.uNormalTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, app.meshAoDepthTexture);
    gl.uniform1i(app.meshAoLocations.uDepthTexture, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.positionBuffer);
    gl.enableVertexAttribArray(app.meshAoLocations.aPosition);
    gl.vertexAttribPointer(app.meshAoLocations.aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawBuffers([gl.BACK]);
    gl.depthMask(true);
    gl.activeTexture(gl.TEXTURE0);

    return true;
}

function renderMeshAoBlurOverlay() {
    let gl = app.gl;

    if (!app.meshAoBlurProgram || !app.meshAoMaskTexture || !app.meshAoNormalTexture) {
        return;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, app.canvas.width, app.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquation(gl.FUNC_ADD);
    gl.useProgram(app.meshAoBlurProgram);
    gl.uniform2f(app.meshAoBlurLocations.uResolution, app.canvas.width, app.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, app.meshAoMaskTexture);
    gl.uniform1i(app.meshAoBlurLocations.uAoTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, app.meshAoDepthTexture);
    gl.uniform1i(app.meshAoBlurLocations.uDepthTexture, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, app.meshAoNormalTexture);
    gl.uniform1i(app.meshAoBlurLocations.uNormalTexture, 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.positionBuffer);
    gl.enableVertexAttribArray(app.meshAoBlurLocations.aPosition);
    gl.vertexAttribPointer(app.meshAoBlurLocations.aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.activeTexture(gl.TEXTURE0);
}

function ensureMeshAoFramebuffer() {
    let gl = app.gl;
    let status = 0;

    if (!app.meshAoFramebuffer) {
        app.meshAoFramebuffer = gl.createFramebuffer();
    }

    if (!app.meshAoMaskFramebuffer) {
        app.meshAoMaskFramebuffer = gl.createFramebuffer();
    }

    if (!app.meshAoNormalTexture) {
        app.meshAoNormalTexture = gl.createTexture();

        if (app.meshAoNormalTexture) {
            configureMeshAoTexture(app.meshAoNormalTexture);
        }
    }

    if (!app.meshAoDepthTexture) {
        app.meshAoDepthTexture = gl.createTexture();

        if (app.meshAoDepthTexture) {
            configureMeshAoTexture(app.meshAoDepthTexture);
        }
    }

    if (!app.meshAoMaskTexture) {
        app.meshAoMaskTexture = gl.createTexture();

        if (app.meshAoMaskTexture) {
            configureMeshAoTexture(app.meshAoMaskTexture);
        }
    }

    if (!app.meshAoFramebuffer || !app.meshAoMaskFramebuffer || !app.meshAoNormalTexture || !app.meshAoDepthTexture || !app.meshAoMaskTexture) {
        reportMeshAoUnavailable("Mesh AO unavailable: could not create framebuffer resources.");
        return false;
    }

    if (app.meshAoWidth === app.canvas.width && app.meshAoHeight === app.canvas.height) {
        return true;
    }

    resizeMeshAoTextures(app.canvas.width, app.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, app.meshAoFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, app.meshAoNormalTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, app.meshAoDepthTexture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

    if (status === gl.FRAMEBUFFER_COMPLETE) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, app.meshAoMaskFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, app.meshAoMaskTexture, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawBuffers([gl.BACK]);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        app.meshAoWidth = 0;
        app.meshAoHeight = 0;
        reportMeshAoUnavailable("Mesh AO unavailable: framebuffer is incomplete.");
        return false;
    }

    app.meshAoWidth = app.canvas.width;
    app.meshAoHeight = app.canvas.height;

    return true;
}

function configureMeshAoTexture(texture) {
    let gl = app.gl;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

function resizeMeshAoTextures(width, height) {
    let gl = app.gl;

    gl.bindTexture(gl.TEXTURE_2D, app.meshAoNormalTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, app.meshAoDepthTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.bindTexture(gl.TEXTURE_2D, app.meshAoMaskTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

function reportMeshAoUnavailable(message) {
    if (app.meshAoWarningShown) {
        return;
    }

    app.meshAoWarningShown = true;
    setStatus(message);
}

function renderSkyBackground(camera) {
    let gl = app.gl;

    if (!app.skyProgram) {
        gl.clearColor(0.94, 0.96, 0.98, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
    }

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(app.skyProgram);
    gl.uniform2f(app.skyLocations.uResolution, app.canvas.width, app.canvas.height);
    gl.uniform3f(app.skyLocations.uCameraPosition, camera.x, camera.y, camera.z);
    gl.uniform3f(app.skyLocations.uCameraTarget, app.cameraTargetX, app.cameraTargetY, app.cameraTargetZ);
    gl.uniform3f(app.skyLocations.uCameraRight, camera.rightX, camera.rightY, camera.rightZ);
    gl.uniform3f(app.skyLocations.uCameraUp, camera.upX, camera.upY, camera.upZ);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.positionBuffer);
    gl.enableVertexAttribArray(app.skyLocations.aPosition);
    gl.vertexAttribPointer(app.skyLocations.aPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function renderMeshGridPlane(matrix, camera, writeDepth) {
    let gl = app.gl;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(writeDepth);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(app.meshProgram);
    gl.uniformMatrix4fv(app.meshLocations.uMatrix, false, matrix);
    gl.uniform3f(app.meshLocations.uCameraPosition, camera.x, camera.y, camera.z);
    gl.uniform1i(app.meshLocations.uMeshMode, meshModeGrid);
    gl.uniform1f(app.meshLocations.uAlpha, 1.0);
    gl.uniform1f(app.meshLocations.uBoundsSize, cleanExportVolumeSize(app.meshBound.value));
    gl.bindBuffer(gl.ARRAY_BUFFER, app.gridPlaneBuffer);
    gl.enableVertexAttribArray(app.meshLocations.aPosition);
    gl.vertexAttribPointer(app.meshLocations.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(app.meshLocations.aColor);
    gl.disableVertexAttribArray(app.meshLocations.aNormal);
    gl.vertexAttrib3f(app.meshLocations.aColor, 0.0, 0.0, 0.0);
    gl.vertexAttrib3f(app.meshLocations.aNormal, 0.0, 0.0, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, app.gridPlaneVertexCount);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
}

function uploadMeshPreview(positions) {
    let gl = app.gl;
    let buffers = buildMeshPreviewBuffers(positions);

    if (!gl) {
        return;
    }

    if (!app.meshPositionBuffer) {
        app.meshPositionBuffer = gl.createBuffer();
    }

    if (!app.meshColorBuffer) {
        app.meshColorBuffer = gl.createBuffer();
    }

    if (!app.meshNormalBuffer) {
        app.meshNormalBuffer = gl.createBuffer();
    }

    if (!app.meshWireBuffer) {
        app.meshWireBuffer = gl.createBuffer();
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, app.meshPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.meshColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, buffers.colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.meshNormalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, buffers.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, app.meshWireBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, buffers.wirePositions, gl.STATIC_DRAW);
    app.meshTriangleVertexCount = positions.length / 3;
    app.meshWireVertexCount = buffers.wirePositions.length / 3;
}

function buildMeshPreviewBuffers(positions) {
    let colors = new Float32Array(positions.length);
    let normals = new Float32Array(positions.length);
    let triangleCount = Math.floor(positions.length / 9);
    let wirePositions = new Float32Array(triangleCount * 18);
    let triangleIndex = 0;
    let vertexIndex = 0;
    let edgeIndex = 0;
    let base = 0;
    let wireBase = 0;
    let firstOffset = 0;
    let secondOffset = 0;
    let red = 0.0;
    let green = 0.0;
    let blue = 0.0;
    let ux = 0.0;
    let uy = 0.0;
    let uz = 0.0;
    let vx = 0.0;
    let vy = 0.0;
    let vz = 0.0;
    let nx = 0.0;
    let ny = 0.0;
    let nz = 1.0;
    let normalLength = 0.0;

    for (triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
        base = triangleIndex * 9;
        wireBase = triangleIndex * 18;
        red = 0.24 + pseudoRandomColor(triangleIndex, 17) * 0.66;
        green = 0.24 + pseudoRandomColor(triangleIndex, 43) * 0.66;
        blue = 0.24 + pseudoRandomColor(triangleIndex, 79) * 0.66;
        ux = positions[base + 3] - positions[base];
        uy = positions[base + 4] - positions[base + 1];
        uz = positions[base + 5] - positions[base + 2];
        vx = positions[base + 6] - positions[base];
        vy = positions[base + 7] - positions[base + 1];
        vz = positions[base + 8] - positions[base + 2];
        nx = uy * vz - uz * vy;
        ny = uz * vx - ux * vz;
        nz = ux * vy - uy * vx;
        normalLength = Math.hypot(nx, ny, nz);

        if (normalLength > 0.0) {
            nx /= normalLength;
            ny /= normalLength;
            nz /= normalLength;
        } else {
            nx = 0.0;
            ny = 0.0;
            nz = 1.0;
        }

        for (vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
            colors[base + vertexIndex * 3] = red;
            colors[base + vertexIndex * 3 + 1] = green;
            colors[base + vertexIndex * 3 + 2] = blue;
            normals[base + vertexIndex * 3] = nx;
            normals[base + vertexIndex * 3 + 1] = ny;
            normals[base + vertexIndex * 3 + 2] = nz;
        }

        // Build wireframe edges while the triangle source indices are already hot.
        for (edgeIndex = 0; edgeIndex < meshWireEdgeOffsets.length; edgeIndex += 2) {
            firstOffset = base + meshWireEdgeOffsets[edgeIndex];
            secondOffset = base + meshWireEdgeOffsets[edgeIndex + 1];
            wirePositions[wireBase] = positions[firstOffset];
            wirePositions[wireBase + 1] = positions[firstOffset + 1];
            wirePositions[wireBase + 2] = positions[firstOffset + 2];
            wirePositions[wireBase + 3] = positions[secondOffset];
            wirePositions[wireBase + 4] = positions[secondOffset + 1];
            wirePositions[wireBase + 5] = positions[secondOffset + 2];
            wireBase += 6;
        }
    }

    return {
        colors: colors,
        normals: normals,
        wirePositions: wirePositions
    };
}

function pseudoRandomColor(index, salt) {
    let value = (index + 1) * (salt * 97 + 53);

    value = value % 251;

    return value / 250.0;
}

function setupQuad() {
    let gl = app.gl;
    let data = new Float32Array([
        -1.0, -1.0,
        3.0, -1.0,
        -1.0, 3.0
    ]);

    app.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, app.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
}

function setupGridPlane() {
    let gl = app.gl;
    let extent = 2000.0;
    let data = new Float32Array([
        -extent, -extent, 0.0,
        extent, -extent, 0.0,
        -extent, extent, 0.0,
        extent, -extent, 0.0,
        extent, extent, 0.0,
        -extent, extent, 0.0
    ]);

    app.gridPlaneBuffer = gl.createBuffer();
    app.gridPlaneVertexCount = 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, app.gridPlaneBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
}

function setupStaticProgram(programField, locationsField, vertexSource, fragmentSource, locationsFunc) {
    let programResult = createProgram(app.gl, vertexSource, fragmentSource);

    if (!programResult.ok) {
        setStatus(programResult.error);
        return false;
    }

    app[programField] = programResult.program;
    app[locationsField] = locationsFunc(app.gl, programResult.program);

    return true;
}

function loadTextFiles(paths, callback) {
    let texts = [];
    let errors = [];
    let remaining = paths.length;
    let index = 0;

    for (index = 0; index < paths.length; index += 1) {
        loadTextFile(paths[index], index, onTextLoaded);
    }

    function onTextLoaded(fileIndex, ok, text, error) {
        if (ok) {
            texts[fileIndex] = text;
        } else {
            errors.push(error);
        }

        remaining -= 1;

        if (remaining === 0) {
            callback(errors.length === 0, texts, errors);
        }
    }
}

function loadTextFile(path, index, callback) {
    let request = new XMLHttpRequest();

    request.open("GET", path, true);

    request.onload = function onShaderLoad() {
        if ((request.status >= 200 && request.status < 300) || request.status === 0) {
            callback(index, true, request.responseText, "");
        } else {
            callback(index, false, "", path + " returned HTTP " + request.status + ".");
        }
    };

    request.onerror = function onShaderError() {
        callback(index, false, "", "Could not request " + path + ".");
    };

    request.send();
}

function injectSceneSource(template, sceneSource) {
    let startMarker = "/* SDFMAKE_SCENE_START */";
    let endMarker = "/* SDFMAKE_SCENE_END */";
    let startIndex = template.indexOf(startMarker);
    let endIndex = template.indexOf(endMarker);

    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
        return template;
    }

    return template.slice(0, startIndex + startMarker.length)
        + "\n"
        + sceneSource
        + "\n"
        + template.slice(endIndex);
}

function buildSdfFragmentSource(mode) {
    return injectSdfModeSource(injectSceneSource(app.fragmentTemplate, app.sdfSceneSource), sdfModeIsPhoto(mode));
}

function injectSdfModeSource(source, photoMode) {
    let lineEnd = source.indexOf("\n");
    let defineValue = "0";

    if (photoMode) {
        defineValue = "1";
    }

    if (lineEnd < 0) {
        return source + "\n#define SDFMAKE_PHOTO_MODE " + defineValue + "\n";
    }

    return source.slice(0, lineEnd + 1)
        + "#define SDFMAKE_PHOTO_MODE "
        + defineValue
        + "\n"
        + source.slice(lineEnd + 1);
}

// Start only the SDF shader variant the current preview actually needs.
function requestSdfProgramForMode(mode) {
    let cleanMode = cleanSdfMode(mode);
    let fragmentSource = "";

    if (app.sdfSceneSource === "" || app.fragmentTemplate.length === 0) {
        return;
    }

    if (getSdfProgramVersion(cleanMode) === app.sdfSceneVersion) {
        return;
    }

    if (app.sdfCompileJob) {
        app.sdfCompileDirty = app.sdfCompileJob.mode !== cleanMode
            || app.sdfCompileJob.version !== app.sdfSceneVersion;

        if (app.sdfCompileDirty) {
            setStatus("Compiling shader. Latest preview change queued.");
        }

        app.needsRender = true;
        updatePreviewOverlay();
        return;
    }

    if (app.sdfCompilePending) {
        if (app.sdfCompilePending.mode === cleanMode && app.sdfCompilePending.version === app.sdfSceneVersion) {
            app.needsRender = true;
            updatePreviewOverlay();
            return;
        }
    }

    fragmentSource = buildSdfFragmentSource(cleanMode);
    queueSdfProgramCompilation(cleanMode, fragmentSource, app.sdfPrimitiveCount, app.sdfSceneVersion);
}

function queueSdfProgramCompilation(mode, fragmentSource, primitiveCount, version) {
    app.sdfCompileDirty = false;
    app.sdfCompilePending = {
        mode: mode,
        fragmentSource: fragmentSource,
        primitiveCount: primitiveCount,
        version: version
    };
    app.needsRender = true;
    setStatus("Compiling " + formatSdfModeName(mode) + " shader. " + primitiveCount + " primitives.");
    updatePreviewOverlay();
    scheduleDeferredSdfProgramCompilation();
}

function scheduleDeferredSdfProgramCompilation() {
    if (app.sdfCompileStartQueued) {
        return;
    }

    app.sdfCompileStartQueued = true;
    window.requestAnimationFrame(onSdfCompileAnimationFrame);
}

function onSdfCompileAnimationFrame() {
    window.setTimeout(onSdfCompileStartTimer, 0);
}

function onSdfCompileStartTimer() {
    let pending = app.sdfCompilePending;

    app.sdfCompileStartQueued = false;

    if (!pending || app.sdfCompileJob) {
        return;
    }

    app.sdfCompilePending = null;
    startSdfProgramCompilation(pending.mode, pending.fragmentSource, pending.primitiveCount, pending.version);
}

// Start the generated SDF shader rebuild while leaving the current program usable.
function startSdfProgramCompilation(mode, fragmentSource, primitiveCount, version) {
    let programResult = null;
    let job = null;

    if (!app.parallelShaderCompileExtension) {
        programResult = createProgram(app.gl, app.vertexSource, fragmentSource);

        if (!programResult.ok) {
            setStatus(programResult.error);
            return;
        }

        activateSdfProgram(mode, programResult.program, primitiveCount, version);
        return;
    }

    job = createProgramLinkJob(app.gl, app.vertexSource, fragmentSource);

    if (!job.ok) {
        setStatus(job.error);
        return;
    }

    job.mode = mode;
    job.version = version;
    job.primitiveCount = primitiveCount;
    app.sdfCompileJob = job;
    app.sdfCompileLastPollTime = 0.0;
    app.needsRender = true;
    setStatus("Compiling " + formatSdfModeName(mode) + " shader. " + primitiveCount + " primitives.");
    updatePreviewOverlay();
}

// Poll the browser's non-blocking link completion flag at a low fixed rate.
function pollSdfProgramCompilation(time) {
    let job = app.sdfCompileJob;
    let gl = app.gl;
    let ext = app.parallelShaderCompileExtension;
    let complete = false;
    let pollTime = time;

    if (!job || !gl || !ext) {
        return;
    }

    if (!Number.isFinite(pollTime)) {
        pollTime = window.performance.now();
    }

    if (app.sdfCompileLastPollTime > 0.0 && pollTime - app.sdfCompileLastPollTime < sdfCompilePollIntervalMs) {
        return;
    }

    app.sdfCompileLastPollTime = pollTime;
    complete = gl.getProgramParameter(job.program, ext.COMPLETION_STATUS_KHR);

    if (!complete) {
        return;
    }

    if (app.sdfCompileDirty) {
        app.sdfCompileDirty = false;
        app.sdfCompileJob = null;
        deleteProgramLinkJob(gl, job, true);
        requestSdfProgramForMode(getNeededSdfMode());
        app.needsRender = true;
        updatePreviewOverlay();
        return;
    }

    if (job.version !== app.sdfSceneVersion) {
        app.sdfCompileJob = null;
        deleteProgramLinkJob(gl, job, true);
        requestSdfProgramForMode(getNeededSdfMode());
        app.needsRender = true;
        updatePreviewOverlay();
        return;
    }

    finishSdfProgramCompilation(job);
}

// Check final link errors only after the async completion query says linking is done.
function finishSdfProgramCompilation(job) {
    let gl = app.gl;
    let linkLog = "";
    let vertexLog = "";
    let fragmentLog = "";
    let error = "";

    app.sdfCompileJob = null;

    if (!gl.getProgramParameter(job.program, gl.LINK_STATUS)) {
        linkLog = gl.getProgramInfoLog(job.program);
        vertexLog = gl.getShaderInfoLog(job.vertexShader);
        fragmentLog = gl.getShaderInfoLog(job.fragmentShader);
        error = "Shader link error:\n" + linkLog;

        if (vertexLog !== "") {
            error += "\nVertex shader error:\n" + vertexLog;
        }

        if (fragmentLog !== "") {
            error += "\nFragment shader error:\n" + fragmentLog;
        }

        deleteProgramLinkJob(gl, job, true);
        setStatus(error);
        return;
    }

    deleteProgramLinkJob(gl, job, false);
    activateSdfProgram(job.mode, job.program, job.primitiveCount, job.version);
}

// Swap in a completed SDF program and retire the previous preview shader.
function activateSdfProgram(mode, program, primitiveCount, version) {
    if (sdfModeIsPhoto(mode)) {
        if (app.photoProgram) {
            app.gl.deleteProgram(app.photoProgram);
        }

        app.photoProgram = program;
        app.photoProgramVersion = version;
        app.photoLocations = getLocations(app.gl, app.photoProgram);
    } else {
        if (app.program) {
            app.gl.deleteProgram(app.program);
        }

        app.program = program;
        app.programVersion = version;
        app.locations = getLocations(app.gl, app.program);
    }

    app.needsRender = true;
    setStatus("Ready. " + formatSdfModeName(mode) + " shader. " + primitiveCount + " primitives.");
    updatePreviewOverlay();
}

function cleanSdfMode(mode) {
    if (sdfModeIsPhoto(mode)) {
        return "sdf-photo";
    }

    return "sdf";
}

function formatSdfModeName(mode) {
    if (sdfModeIsPhoto(mode)) {
        return "Solid photo";
    }

    return "Solid";
}

function getSdfProgram(mode) {
    if (sdfModeIsPhoto(mode)) {
        return app.photoProgram;
    }

    return app.program;
}

function getSdfProgramVersion(mode) {
    if (sdfModeIsPhoto(mode)) {
        return app.photoProgramVersion;
    }

    return app.programVersion;
}

function sdfProgramIsCurrent(mode) {
    return getSdfProgram(mode) !== null && getSdfProgramVersion(mode) === app.sdfSceneVersion;
}

function getSdfLocations(mode) {
    if (sdfModeIsPhoto(mode)) {
        return app.photoLocations;
    }

    return app.locations;
}

// Queue shader compilation and program linking without status queries that can stall.
function createProgramLinkJob(gl, vertexSource, fragmentSource) {
    let vertexShader = gl.createShader(gl.VERTEX_SHADER);
    let fragmentShader = null;
    let program = null;

    if (!vertexShader) {
        return {
            ok: false,
            program: null,
            vertexShader: null,
            fragmentShader: null,
            primitiveCount: 0,
            error: "Could not create vertex shader."
        };
    }

    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);

    fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

    if (!fragmentShader) {
        gl.deleteShader(vertexShader);
        return {
            ok: false,
            program: null,
            vertexShader: null,
            fragmentShader: null,
            primitiveCount: 0,
            error: "Could not create fragment shader."
        };
    }

    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);

    program = gl.createProgram();

    if (!program) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        return {
            ok: false,
            program: null,
            vertexShader: null,
            fragmentShader: null,
            primitiveCount: 0,
            error: "Could not create shader program."
        };
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    return {
        ok: true,
        program: program,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        primitiveCount: 0,
        error: ""
    };
}

function deleteProgramLinkJob(gl, job, deleteProgram) {
    gl.deleteShader(job.vertexShader);
    gl.deleteShader(job.fragmentShader);

    if (deleteProgram) {
        gl.deleteProgram(job.program);
    }
}

function createProgram(gl, vertexSource, fragmentSource) {
    let vertexResult = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    let fragmentResult = null;
    let program = null;
    let linkLog = "";

    if (!vertexResult.ok) {
        return {
            ok: false,
            program: null,
            error: "Vertex shader error:\n" + vertexResult.error
        };
    }

    fragmentResult = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    if (!fragmentResult.ok) {
        gl.deleteShader(vertexResult.shader);
        return {
            ok: false,
            program: null,
            error: "Fragment shader error:\n" + fragmentResult.error
        };
    }

    program = gl.createProgram();
    gl.attachShader(program, vertexResult.shader);
    gl.attachShader(program, fragmentResult.shader);
    gl.linkProgram(program);
    gl.deleteShader(vertexResult.shader);
    gl.deleteShader(fragmentResult.shader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        linkLog = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        return {
            ok: false,
            program: null,
            error: "Shader link error:\n" + linkLog
        };
    }

    return {
        ok: true,
        program: program,
        error: ""
    };
}

function compileShader(gl, type, source) {
    let shader = gl.createShader(type);
    let log = "";

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        return {
            ok: false,
            shader: null,
            error: log
        };
    }

    return {
        ok: true,
        shader: shader,
        error: ""
    };
}

function getLocations(gl, program) {
    return {
        aPosition: gl.getAttribLocation(program, "a_position"),
        uResolution: gl.getUniformLocation(program, "u_resolution"),
        uCameraPosition: gl.getUniformLocation(program, "u_camera_position"),
        uCameraTarget: gl.getUniformLocation(program, "u_camera_target"),
        uCameraRight: gl.getUniformLocation(program, "u_camera_right"),
        uCameraUp: gl.getUniformLocation(program, "u_camera_up"),
        uBoundsSize: gl.getUniformLocation(program, "u_bounds_size"),
        uShowBoundsWire: gl.getUniformLocation(program, "u_show_bounds_wire")
    };
}

function getMeshLocations(gl, program) {
    return {
        aPosition: gl.getAttribLocation(program, "a_position"),
        aColor: gl.getAttribLocation(program, "a_color"),
        aNormal: gl.getAttribLocation(program, "a_normal"),
        uMatrix: gl.getUniformLocation(program, "u_matrix"),
        uCameraPosition: gl.getUniformLocation(program, "u_camera_position"),
        uMeshMode: gl.getUniformLocation(program, "u_mesh_mode"),
        uAlpha: gl.getUniformLocation(program, "u_alpha"),
        uBoundsSize: gl.getUniformLocation(program, "u_bounds_size")
    };
}

function getMeshGBufferLocations(gl, program) {
    return {
        aPosition: gl.getAttribLocation(program, "a_position"),
        aNormal: gl.getAttribLocation(program, "a_normal"),
        uMatrix: gl.getUniformLocation(program, "u_matrix"),
        uCameraPosition: gl.getUniformLocation(program, "u_camera_position"),
        uMeshMode: gl.getUniformLocation(program, "u_mesh_mode")
    };
}

function getMeshAoLocations(gl, program) {
    return {
        aPosition: gl.getAttribLocation(program, "a_position"),
        uResolution: gl.getUniformLocation(program, "u_resolution"),
        uMatrix: gl.getUniformLocation(program, "u_matrix"),
        uInverseMatrix: gl.getUniformLocation(program, "u_inverse_matrix"),
        uCameraPosition: gl.getUniformLocation(program, "u_camera_position"),
        uBoundsSize: gl.getUniformLocation(program, "u_bounds_size"),
        uNormalTexture: gl.getUniformLocation(program, "u_normal_texture"),
        uDepthTexture: gl.getUniformLocation(program, "u_depth_texture")
    };
}

function getMeshAoBlurLocations(gl, program) {
    return {
        aPosition: gl.getAttribLocation(program, "a_position"),
        uResolution: gl.getUniformLocation(program, "u_resolution"),
        uAoTexture: gl.getUniformLocation(program, "u_ao_texture"),
        uDepthTexture: gl.getUniformLocation(program, "u_depth_texture"),
        uNormalTexture: gl.getUniformLocation(program, "u_normal_texture")
    };
}

function getSkyLocations(gl, program) {
    return {
        aPosition: gl.getAttribLocation(program, "a_position"),
        uResolution: gl.getUniformLocation(program, "u_resolution"),
        uCameraPosition: gl.getUniformLocation(program, "u_camera_position"),
        uCameraTarget: gl.getUniformLocation(program, "u_camera_target"),
        uCameraRight: gl.getUniformLocation(program, "u_camera_right"),
        uCameraUp: gl.getUniformLocation(program, "u_camera_up")
    };
}

function resizeCanvas() {
    let ratio = window.devicePixelRatio;
    let width = 0;
    let height = 0;

    if (!Number.isFinite(ratio) || ratio <= 0.0) {
        ratio = 1.0;
    }

    width = Math.max(1, Math.floor(app.canvas.clientWidth * ratio));
    height = Math.max(1, Math.floor(app.canvas.clientHeight * ratio));

    if (app.canvas.width !== width || app.canvas.height !== height) {
        app.canvas.width = width;
        app.canvas.height = height;
    }
}

function getCameraPosition() {
    let cosPitch = Math.cos(app.pitch);
    let sinPitch = Math.sin(app.pitch);
    let sinYaw = Math.sin(app.yaw);
    let cosYaw = Math.cos(app.yaw);
    let forwardX = -sinYaw * cosPitch;
    let forwardY = -cosYaw * cosPitch;
    let forwardZ = -sinPitch;
    let rightX = -cosYaw;
    let rightY = sinYaw;
    let rightZ = 0.0;
    let upX = rightY * forwardZ - rightZ * forwardY;
    let upY = rightZ * forwardX - rightX * forwardZ;
    let upZ = rightX * forwardY - rightY * forwardX;

    return {
        x: app.cameraTargetX - forwardX * app.cameraDistance,
        y: app.cameraTargetY - forwardY * app.cameraDistance,
        z: app.cameraTargetZ - forwardZ * app.cameraDistance,
        forwardX: forwardX,
        forwardY: forwardY,
        forwardZ: forwardZ,
        rightX: rightX,
        rightY: rightY,
        rightZ: rightZ,
        upX: upX,
        upY: upY,
        upZ: upZ
    };
}

function buildViewProjectionMatrix(camera) {
    let projection = sdfMatchedPerspectiveMatrix(app.canvas.width, app.canvas.height, 0.1, 5000.0);
    let view = lookAtMatrix(camera);

    return multiplyMatrices(projection, view);
}

function buildInverseViewProjectionMatrix(camera) {
    let inverseProjection = sdfMatchedInversePerspectiveMatrix(app.canvas.width, app.canvas.height, 0.1, 5000.0);
    let inverseView = inverseLookAtMatrix(camera);

    return multiplyMatrices(inverseView, inverseProjection);
}

function cleanProjectionDimensions(width, height) {
    let cleanWidth = width;
    let cleanHeight = height;
    let scale = 1.0;

    if (!Number.isFinite(cleanWidth) || cleanWidth <= 0.0) {
        cleanWidth = 1.0;
    }

    if (!Number.isFinite(cleanHeight) || cleanHeight <= 0.0) {
        cleanHeight = 1.0;
    }

    scale = cleanWidth;

    if (cleanHeight < scale) {
        scale = cleanHeight;
    }

    if (!Number.isFinite(scale) || scale <= 0.0) {
        scale = 1.0;
    }

    return {
        width: cleanWidth,
        height: cleanHeight,
        scale: scale
    };
}

function sdfMatchedPerspectiveMatrix(width, height, nearValue, farValue) {
    let out = new Float32Array(16);
    let dimensions = cleanProjectionDimensions(width, height);

    out[0] = dimensions.scale / dimensions.width;
    out[5] = dimensions.scale / dimensions.height;
    out[10] = (farValue + nearValue) / (nearValue - farValue);
    out[11] = -1.0;
    out[14] = 2.0 * farValue * nearValue / (nearValue - farValue);

    return out;
}

function sdfMatchedInversePerspectiveMatrix(width, height, nearValue, farValue) {
    let out = new Float32Array(16);
    let dimensions = cleanProjectionDimensions(width, height);
    let a = (farValue + nearValue) / (nearValue - farValue);
    let b = 2.0 * farValue * nearValue / (nearValue - farValue);

    out[0] = dimensions.width / dimensions.scale;
    out[5] = dimensions.height / dimensions.scale;
    out[11] = 1.0 / b;
    out[14] = -1.0;
    out[15] = a / b;

    return out;
}

function lookAtMatrix(camera) {
    let out = new Float32Array(16);
    let xx = camera.rightX;
    let xy = camera.rightY;
    let xz = camera.rightZ;
    let yx = camera.upX;
    let yy = camera.upY;
    let yz = camera.upZ;
    let zx = -camera.forwardX;
    let zy = -camera.forwardY;
    let zz = -camera.forwardZ;

    out[0] = xx;
    out[1] = yx;
    out[2] = zx;
    out[4] = xy;
    out[5] = yy;
    out[6] = zy;
    out[8] = xz;
    out[9] = yz;
    out[10] = zz;
    out[12] = -(xx * camera.x + xy * camera.y + xz * camera.z);
    out[13] = -(yx * camera.x + yy * camera.y + yz * camera.z);
    out[14] = -(zx * camera.x + zy * camera.y + zz * camera.z);
    out[15] = 1.0;

    return out;
}

function inverseLookAtMatrix(camera) {
    let out = new Float32Array(16);

    out[0] = camera.rightX;
    out[1] = camera.rightY;
    out[2] = camera.rightZ;
    out[4] = camera.upX;
    out[5] = camera.upY;
    out[6] = camera.upZ;
    out[8] = -camera.forwardX;
    out[9] = -camera.forwardY;
    out[10] = -camera.forwardZ;
    out[12] = camera.x;
    out[13] = camera.y;
    out[14] = camera.z;
    out[15] = 1.0;

    return out;
}

function multiplyMatrices(a, b) {
    let out = new Float32Array(16);
    let row = 0;
    let column = 0;
    let index = 0;
    let sum = 0.0;

    for (column = 0; column < 4; column += 1) {
        for (row = 0; row < 4; row += 1) {
            sum = 0.0;

            for (index = 0; index < 4; index += 1) {
                sum += a[index * 4 + row] * b[column * 4 + index];
            }

            out[column * 4 + row] = sum;
        }
    }

    return out;
}

function formatErrors(prefix, errors) {
    let text = prefix;
    let index = 0;
    let limit = 0;

    if (!errors || errors.length === 0) {
        return text;
    }

    limit = Math.min(errors.length, 8);

    for (index = 0; index < limit; index += 1) {
        text += "\n" + errors[index];
    }

    if (errors.length > limit) {
        text += "\nAdditional errors omitted.";
    }

    return text;
}

function setStatus(text) {
    app.statusMessage.textContent = text;
}
