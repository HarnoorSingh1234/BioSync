"use client";

import { useEffect } from "react";

type Nullable<T> = T | null;

export default function ConnectPage() {
	useEffect(() => {
		const state = {
			backendUrl: "http://localhost:8000",
			currentStep: "source",
			ws: null as Nullable<WebSocket>,
			previewCanvas: null as Nullable<HTMLCanvasElement>,
			previewCtx: null as Nullable<CanvasRenderingContext2D>,
			previewCanvasParams: null as Nullable<HTMLCanvasElement>,
			previewCtxParams: null as Nullable<CanvasRenderingContext2D>,
			offscreen: document.createElement("canvas"),
			offscreenCtx: null as Nullable<CanvasRenderingContext2D>,
			previewFrameWidth: 0,
			previewFrameHeight: 0,
			latestImageData: null as Nullable<ImageData>,
			latestPupilMask: null as any,
			latestGlintMask: null as any,
			activeRoiRect: null as Nullable<{ x: number; y: number; width: number; height: number }>,
			pendingRoiFrame: null as Nullable<{ x: number; y: number; width: number; height: number }>,
			serverRoi: null as Nullable<{ x: number; y: number; width: number; height: number }>,
			drawingRoi: false,
			roiStart: null as Nullable<{ x: number; y: number }>,
			pickMode: null as Nullable<"pupil" | "glint">,
			parameterDebounce: null as Nullable<number>,
			messageTimer: null as Nullable<number>,
			previewStopRequested: false,
			visibilityTimeout: null as Nullable<number>,
			displayCanvas: null as Nullable<HTMLCanvasElement>,
			displayCtx: null as Nullable<CanvasRenderingContext2D>,
			displayMode: null as Nullable<"calibration" | "tracking">,
			displayAnimation: 0,
			displayVisible: false,
			displayResumeEnabled: false,
			displayActionBusy: false,
			displayActionLockUntil: 0,
			displayCanvasBounds: null as any,
			displayCanvasScale: 1,
			gazePoll: null as Nullable<number>,
			trackingDot: null as Nullable<{ x: number; y: number }>,
			trackingHistory: [] as Array<{ x: number; y: number }>,
			trackingMaxHistory: 32,
			fallbackGaze: null as any,
			lastGazeAt: 0,
			calibrationPoints: [] as Array<{ x: number; y: number; nx: number; ny: number }>,
			calibrationIndex: 0,
			calibrationCollected: 0,
			calibrationScreen: null as Nullable<{ width: number; height: number }>,
			isCapturing: false,
			captureStart: 0,
			resumeButton: null as Nullable<HTMLButtonElement>,
			showTrackingButton: null as Nullable<HTMLButtonElement>,
			trackingAvailable: false,
			pupilMaskCanvas: null as Nullable<HTMLCanvasElement>,
			pupilMaskCtx: null as Nullable<CanvasRenderingContext2D>,
			pupilMaskLabel: null as Nullable<HTMLDivElement>,
			glintMaskCanvas: null as Nullable<HTMLCanvasElement>,
			glintMaskCtx: null as Nullable<CanvasRenderingContext2D>,
			glintMaskLabel: null as Nullable<HTMLDivElement>,
		};

		const cleanupFns: Array<() => void> = [];

		const messageSuccessClasses = ["bg-emerald-500/20", "border-emerald-500/30", "text-emerald-200"];
		const messageErrorClasses = ["bg-red-500/20", "border-red-500/25", "text-red-200"];
		const BACKEND_URL_STORAGE_KEY = "eye-tracker-backend-url";
		const CALIBRATION_STORAGE_KEY = "eye-tracker-calibration";
		const OVERLAY_ENABLED_KEY = "eye-tracker-overlay-enabled";
		const OVERLAY_EVENT_NAME = "eye-tracking-overlay-update";

		const dispatchOverlayUpdate = () => {
			try {
				window.dispatchEvent(new CustomEvent(OVERLAY_EVENT_NAME));
			} catch (error) {
				console.warn("Overlay event dispatch", error);
			}
		};

		const persistBackendUrl = (url: string) => {
			try {
				localStorage.setItem(BACKEND_URL_STORAGE_KEY, url);
				dispatchOverlayUpdate();
			} catch (error) {
				console.warn("Persist backend URL", error);
			}
		};

		const persistCalibration = (calibration: { width: number; height: number } | null) => {
			if (!calibration) {
				return;
			}
			try {
				localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibration));
				dispatchOverlayUpdate();
			} catch (error) {
				console.warn("Persist calibration", error);
			}
		};

		const disableGlobalOverlay = () => {
			try {
				localStorage.removeItem(OVERLAY_ENABLED_KEY);
				dispatchOverlayUpdate();
			} catch (error) {
				console.warn("Disable overlay", error);
			}
		};

		const getSiteOverlayButton = () =>
			document.getElementById("display-site-overlay") as HTMLButtonElement | null;

		const setSiteOverlayDisabled = (disabled: boolean) => {
			const button = getSiteOverlayButton();
			if (button) {
				button.disabled = disabled;
			}
		};

		function updateTrackingButton() {
			const button = state.showTrackingButton;
			if (!button) {
				return;
			}
			const enabled = Boolean(state.trackingAvailable) && state.currentStep === "params";
			button.disabled = !enabled;
			button.textContent = "Show Tracking Overlay";
			button.title = enabled ? "" : "Complete calibration to enable tracking overlay.";
		}

		function closePreviewSocket() {
			if (state.ws) {
				state.ws.onopen = null;
				state.ws.onclose = null;
				state.ws.onerror = null;
				state.ws.onmessage = null;
				state.ws.close();
				state.ws = null;
			}
		}

		function stopGazePolling() {
			if (state.gazePoll) {
				window.clearInterval(state.gazePoll);
				state.gazePoll = null;
			}
		}

		function setMessage(message: string, ok = false) {
			const bar = document.getElementById("message-bar");
			if (!bar) {
				return;
			}
			if (state.messageTimer) {
				window.clearTimeout(state.messageTimer);
				state.messageTimer = null;
			}
			bar.textContent = message || "";
			[...messageSuccessClasses, ...messageErrorClasses].forEach((cls) => bar.classList.remove(cls));
			const palette = ok ? messageSuccessClasses : messageErrorClasses;
			palette.forEach((cls) => bar.classList.add(cls));
			if (message && ok) {
				state.messageTimer = window.setTimeout(() => {
					bar.textContent = "";
					palette.forEach((cls) => bar.classList.remove(cls));
					messageErrorClasses.forEach((cls) => bar.classList.add(cls));
					state.messageTimer = null;
				}, 3200);
			}
		}

		const lockDisplayActions = (durationMs = 400) => {
			state.displayActionLockUntil = Date.now() + Math.max(0, durationMs);
		};

		const runDisplayAction = async (fn: () => Promise<void> | void) => {
			if (state.displayActionLockUntil && Date.now() < state.displayActionLockUntil) {
				return;
			}
			state.displayActionLockUntil = 0;
			if (state.displayActionBusy) {
				return;
			}
			state.displayActionBusy = true;
			try {
				await fn();
			} finally {
				state.displayActionBusy = false;
			}
		};

		function ensurePreviewSocket() {
			if (state.ws && state.ws.readyState === WebSocket.OPEN) {
				return;
			}
			connectPreviewSocket();
		}

		function connectPreviewSocket() {
			closePreviewSocket();
			try {
				const base = new URL(state.backendUrl);
				base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
				base.pathname = "/ws/preview";
				const ws = new WebSocket(base.href);
				ws.onopen = () => setMessage("Preview stream connected", true);
				ws.onerror = () => setMessage("Preview stream error");
				ws.onclose = () => setMessage("Preview stream closed");
				ws.onmessage = (event) => handlePreviewFrame(event.data as string);
				state.ws = ws;
			} catch (error) {
				console.error("Preview socket error", error);
			}
		}

		function setStep(stepName: "source" | "roi" | "params") {
			state.currentStep = stepName;
			document.querySelectorAll<HTMLElement>(".step").forEach((section) => {
				const isActive = section.dataset.step === stepName;
				section.classList.toggle("active", isActive);
				section.classList.toggle("hidden", !isActive);
				section.classList.toggle("flex", isActive);
			});
			if (stepName === "source") {
				closePreviewSocket();
				disableGlobalOverlay();
			} else {
				ensurePreviewSocket();
			}
			updateTrackingButton();
		}

		function drawRoiOverlay(
			ctx: Nullable<CanvasRenderingContext2D>,
			rect: Nullable<{ x: number; y: number; width: number; height: number }>,
			color: string,
		) {
			if (!ctx || !rect) {
				return;
			}
			ctx.save();
			ctx.strokeStyle = color;
			ctx.lineWidth = 2;
			ctx.setLineDash([10, 6]);
			ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
			ctx.restore();
		}

		function resizeCanvasToMaintainAspect(canvas: Nullable<HTMLCanvasElement>, aspect: number) {
			if (!canvas) {
				return;
			}
			const parent = canvas.parentElement as HTMLElement | null;
			if (!parent) {
				return;
			}
			const width = parent.clientWidth;
			const height = width / aspect;
			canvas.width = width;
			canvas.height = height;
		}

		function scaleRoiToCanvas(roi: [number, number, number, number], canvas: Nullable<HTMLCanvasElement>) {
			if (!canvas || !state.previewFrameWidth || !state.previewFrameHeight) {
				return { x: 0, y: 0, width: 0, height: 0 };
			}
			const scaleX = canvas.width / state.previewFrameWidth;
			const scaleY = canvas.height / state.previewFrameHeight;
			return {
				x: roi[0] * scaleX,
				y: roi[1] * scaleY,
				width: roi[2] * scaleX,
				height: roi[3] * scaleY,
			};
		}

		function canvasToFrame(rect: { x: number; y: number; width: number; height: number }) {
			const canvas = state.previewCanvas;
			if (!canvas || !state.previewFrameWidth || !state.previewFrameHeight) {
				return { x: 0, y: 0, width: 0, height: 0 };
			}
			const scaleX = state.previewFrameWidth / canvas.width;
			const scaleY = state.previewFrameHeight / canvas.height;
			return {
				x: Math.max(0, Math.round(rect.x * scaleX)),
				y: Math.max(0, Math.round(rect.y * scaleY)),
				width: Math.max(1, Math.round(rect.width * scaleX)),
				height: Math.max(1, Math.round(rect.height * scaleY)),
			};
		}

		function drawOnCanvas(
			canvas: Nullable<HTMLCanvasElement>,
			ctx: Nullable<CanvasRenderingContext2D>,
			image: HTMLImageElement,
			roi?: [number, number, number, number],
		) {
			if (!canvas || !ctx) {
				return;
			}
			resizeCanvasToMaintainAspect(canvas, image.width / image.height);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
			if (roi) {
				const rect = scaleRoiToCanvas(roi, canvas);
				drawRoiOverlay(ctx, rect, "rgba(39, 174, 96, 0.85)");
			}
		}

		function updateMaskCanvas(
			canvas: Nullable<HTMLCanvasElement>,
			ctx: Nullable<CanvasRenderingContext2D>,
			maskInfo: any,
			accentColor: string,
			labelEl: Nullable<HTMLDivElement>,
		) {
			if (!canvas || !ctx) {
				return;
			}
			if (!maskInfo || !maskInfo.data) {
				const parentWidth = canvas.parentElement?.clientWidth || canvas.width || 240;
				const height = Math.max(Math.round(parentWidth * 0.65), 120);
				canvas.width = parentWidth;
				canvas.height = height;
				ctx.fillStyle = "#05090f";
				ctx.fillRect(0, 0, canvas.width, canvas.height);
				if (labelEl) {
					const text = (labelEl.dataset?.default as string | undefined) || "No data";
					labelEl.textContent = text;
					labelEl.style.display = "block";
				}
				return;
			}
			const maskImage = new Image();
			maskImage.onload = () => {
				const parentWidth = canvas.parentElement?.clientWidth || canvas.width || 240;
				const aspect = maskImage.width / maskImage.height || 1;
				canvas.width = parentWidth;
				canvas.height = parentWidth / aspect;
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
				if (labelEl) {
					labelEl.style.display = "none";
				}
				ctx.strokeStyle = accentColor;
				ctx.lineWidth = 2;
				ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
			};
			maskImage.src = `data:image/png;base64,${maskInfo.data}`;
		}

		function clearMaskCanvas(
			canvas: Nullable<HTMLCanvasElement>,
			ctx: Nullable<CanvasRenderingContext2D>,
			labelEl: Nullable<HTMLDivElement>,
			message = "No data",
		) {
			if (!canvas || !ctx) {
				return;
			}
			const parentWidth = canvas.parentElement?.clientWidth || canvas.width || 240;
			const height = Math.max(Math.round(parentWidth * 0.65), 120);
			canvas.width = parentWidth;
			canvas.height = height;
			ctx.fillStyle = "#05090f";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			if (labelEl) {
				const fallback = (labelEl.dataset?.default as string | undefined) || "No data";
				labelEl.textContent = message ?? fallback;
				labelEl.style.display = "block";
			}
		}

		function handlePreviewFrame(payload: string) {
			try {
				const frame = JSON.parse(payload);
				if (!frame || !frame.data) {
					return;
				}
				state.previewFrameWidth = frame.width;
				state.previewFrameHeight = frame.height;
				state.latestPupilMask = frame.pupil_mask || null;
				state.latestGlintMask = frame.glint_mask || null;
				drawPreview(frame);
			} catch (error) {
				console.error("Preview frame parse error", error);
			}
		}

		function drawPreview(framePayload: any) {
			const { data: base64Data, roi } = framePayload;
			const image = new Image();
			image.onload = () => {
				drawOnCanvas(state.previewCanvas, state.previewCtx, image, roi);
				drawOnCanvas(state.previewCanvasParams, state.previewCtxParams, image, roi);
				const previewWidth = state.previewCanvas?.width ?? 0;
				const previewHeight = state.previewCanvas?.height ?? 0;
				if (previewWidth > 0 && previewHeight > 0 && state.offscreen) {
					state.offscreen.width = previewWidth;
					state.offscreen.height = previewHeight;
					if (!state.offscreenCtx) {
						state.offscreenCtx = state.offscreen.getContext("2d");
					}
					state.offscreenCtx?.clearRect(0, 0, previewWidth, previewHeight);
					state.offscreenCtx?.drawImage(image, 0, 0, previewWidth, previewHeight);
					state.latestImageData = state.offscreenCtx?.getImageData(0, 0, previewWidth, previewHeight) ?? null;
				} else {
					state.latestImageData = null;
				}
				if (!state.activeRoiRect && state.serverRoi) {
					const canvasRect = scaleRoiToCanvas(
						[state.serverRoi.x, state.serverRoi.y, state.serverRoi.width, state.serverRoi.height],
						state.previewCanvas,
					);
					state.activeRoiRect = canvasRect;
				}
				if (state.activeRoiRect) {
					drawRoiOverlay(state.previewCtx, state.activeRoiRect, "rgba(116, 185, 255, 0.8)");
					drawRoiOverlay(state.previewCtxParams, state.activeRoiRect, "rgba(116, 185, 255, 0.8)");
				}
				updateMaskCanvas(state.pupilMaskCanvas, state.pupilMaskCtx, state.latestPupilMask, "#f1c40f", state.pupilMaskLabel);
				updateMaskCanvas(state.glintMaskCanvas, state.glintMaskCtx, state.latestGlintMask, "#74b9ff", state.glintMaskLabel);
			};
			image.src = `data:image/jpeg;base64,${base64Data}`;
		}

		function beginRoiSelection(event: PointerEvent) {
			if (state.currentStep !== "roi" || !state.previewCanvas) {
				return;
			}
			const rect = state.previewCanvas.getBoundingClientRect();
			state.drawingRoi = true;
			state.roiStart = {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			};
			state.activeRoiRect = { x: state.roiStart.x, y: state.roiStart.y, width: 0, height: 0 };
			drawRoiOverlay(state.previewCtx, state.activeRoiRect, "rgba(116, 185, 255, 0.8)");
		}

		function updateRoiSelection(event: PointerEvent) {
			if (!state.drawingRoi || state.currentStep !== "roi" || !state.previewCanvas || !state.roiStart) {
				return;
			}
			const rect = state.previewCanvas.getBoundingClientRect();
			const current = {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			};
			const width = current.x - state.roiStart.x;
			const height = current.y - state.roiStart.y;
			state.activeRoiRect = {
				x: Math.min(state.roiStart.x, current.x),
				y: Math.min(state.roiStart.y, current.y),
				width: Math.abs(width),
				height: Math.abs(height),
			};
		}

		function updateRoiInputs(roi: { x: number; y: number; width: number; height: number }) {
			const xInput = document.getElementById("roi-x") as HTMLInputElement | null;
			const yInput = document.getElementById("roi-y") as HTMLInputElement | null;
			const widthInput = document.getElementById("roi-width") as HTMLInputElement | null;
			const heightInput = document.getElementById("roi-height") as HTMLInputElement | null;
			if (xInput) xInput.value = String(roi.x);
			if (yInput) yInput.value = String(roi.y);
			if (widthInput) widthInput.value = String(roi.width);
			if (heightInput) heightInput.value = String(roi.height);
		}

		function finishRoiSelection() {
			if (!state.drawingRoi || state.currentStep !== "roi") {
				return;
			}
			state.drawingRoi = false;
			if (!state.activeRoiRect || state.activeRoiRect.width < 30 || state.activeRoiRect.height < 30) {
				setMessage("ROI too small · drag a larger rectangle");
				state.activeRoiRect = null;
				return;
			}
			state.pendingRoiFrame = canvasToFrame(state.activeRoiRect);
			updateRoiInputs(state.pendingRoiFrame);
			const applyBtn = document.getElementById("roi-apply") as HTMLButtonElement | null;
			const nextBtn = document.getElementById("roi-next") as HTMLButtonElement | null;
			if (applyBtn) applyBtn.disabled = false;
			if (nextBtn) nextBtn.disabled = false;
			setMessage("ROI prepared · click Apply to send", true);
		}

		async function applyRoi() {
			const roi = state.pendingRoiFrame;
			if (!roi) {
				setMessage("No ROI to apply");
				return;
			}
			try {
				await fetchJSON("/api/roi", {
					method: "PUT",
					body: JSON.stringify(roi),
				});
				setMessage("ROI applied", true);
			} catch (error: any) {
				setMessage(`ROI apply failed: ${error.message}`);
			}
		}

		async function useFullFrame() {
			try {
				await fetchJSON("/api/roi", { method: "DELETE" });
				setMessage("ROI cleared", true);
				state.pendingRoiFrame = null;
				state.activeRoiRect = null;
				const applyBtn = document.getElementById("roi-apply") as HTMLButtonElement | null;
				const nextBtn = document.getElementById("roi-next") as HTMLButtonElement | null;
				if (applyBtn) applyBtn.disabled = true;
				if (nextBtn) nextBtn.disabled = false;
			} catch (error: any) {
				setMessage(`Unable to clear ROI: ${error.message}`);
			}
		}

		function initParameterControls() {
			const controls: Array<{ id: string; valueId: string; format: (value: string) => string | number }> = [
				{ id: "pupil-thresh", valueId: "pupil-thresh-value", format: (v) => String(Number(v)) },
				{ id: "pupil-blur", valueId: "pupil-blur-value", format: (v) => String(Number(v)) },
				{ id: "glint-thresh", valueId: "glint-thresh-value", format: (v) => String(Number(v)) },
				{ id: "glint-blur", valueId: "glint-blur-value", format: (v) => String(Number(v)) },
				{ id: "ray-history", valueId: "ray-history-value", format: (v) => String(Number(v)) },
				{ id: "smoothing", valueId: "smoothing-value", format: (v) => (Number(v) / 100).toFixed(2) },
			];
			controls.forEach(({ id, valueId, format }) => {
				const input = document.getElementById(id) as HTMLInputElement | null;
				const output = document.getElementById(valueId);
				if (!input || !output) {
					return;
				}
				const handler = () => {
					output.textContent = String(format(input.value));
					scheduleParameterUpdate();
				};
				input.addEventListener("input", handler);
				cleanupFns.push(() => input.removeEventListener("input", handler));
			});
		}

		function currentParameterValues() {
			const pupilThresh = Number((document.getElementById("pupil-thresh") as HTMLInputElement | null)?.value || 0);
			const pupilBlur = Number((document.getElementById("pupil-blur") as HTMLInputElement | null)?.value || 0);
			const glintThresh = Number((document.getElementById("glint-thresh") as HTMLInputElement | null)?.value || 0);
			const glintBlur = Number((document.getElementById("glint-blur") as HTMLInputElement | null)?.value || 0);
			const rayHistory = Number((document.getElementById("ray-history") as HTMLInputElement | null)?.value || 0);
			const smoothing = Number((document.getElementById("smoothing") as HTMLInputElement | null)?.value || 0);
			return {
				pupil_thresh: pupilThresh,
				pupil_blur: pupilBlur,
				glint_thresh: glintThresh,
				glint_blur: glintBlur,
				ray_history: rayHistory,
				smoothing_factor: smoothing / 100,
			};
		}

		function scheduleParameterUpdate() {
			if (state.parameterDebounce) {
				window.clearTimeout(state.parameterDebounce);
			}
			state.parameterDebounce = window.setTimeout(sendParameterUpdate, 200);
		}

		async function sendParameterUpdate() {
			try {
				await fetchJSON("/api/parameters", {
					method: "PUT",
					body: JSON.stringify(currentParameterValues()),
				});
			} catch (error: any) {
				setMessage(`Unable to update parameters: ${error.message}`);
			}
		}

		function setPickMode(mode: "pupil" | "glint") {
			state.pickMode = mode;
			setMessage(`Click on the ${mode === "pupil" ? "dark pupil" : "bright glint"} in the preview`);
		}

		function handlePreviewClick(event: MouseEvent) {
			if (state.currentStep !== "params" || !state.pickMode || !state.latestImageData || !state.previewCanvasParams) {
				return;
			}
			const canvas = state.previewCanvasParams;
			const rect = canvas.getBoundingClientRect();
			const x = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
			const y = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);
			const index = (y * state.latestImageData.width + x) * 4;
			const r = state.latestImageData.data[index];
			const g = state.latestImageData.data[index + 1];
			const b = state.latestImageData.data[index + 2];
			const intensity = (r + g + b) / 3;
			if (state.pickMode === "pupil") {
				const threshold = Math.min(200, Math.max(20, Math.round(intensity + 20)));
				const input = document.getElementById("pupil-thresh") as HTMLInputElement | null;
				const label = document.getElementById("pupil-thresh-value");
				if (input) input.value = String(threshold);
				if (label) label.textContent = String(threshold);
			} else {
				const threshold = Math.max(120, Math.min(255, Math.round(intensity - 25)));
				const input = document.getElementById("glint-thresh") as HTMLInputElement | null;
				const label = document.getElementById("glint-thresh-value");
				if (input) input.value = String(threshold);
				if (label) label.textContent = String(threshold);
			}
			state.pickMode = null;
			scheduleParameterUpdate();
			setMessage("Threshold updated from pixel", true);
		}

		async function startCalibration() {
			const width = window.innerWidth;
			const height = window.innerHeight;
			state.calibrationScreen = { width, height };
			state.trackingAvailable = false;
			updateTrackingButton();
			try {
				const response = await fetchJSON("/api/calibration/start", {
					method: "POST",
					body: JSON.stringify({ screen_width: width, screen_height: height }),
				});
				state.calibrationPoints = (response.points || []).map(([x, y]: [number, number]) => ({
					x,
					y,
					nx: x / width,
					ny: y / height,
				}));
				state.calibrationIndex = 0;
				state.calibrationCollected = 0;
				state.isCapturing = false;
				state.trackingHistory = [];
				state.trackingDot = null;
				enterDisplayMode("calibration");
				setDisplayButtonsForCalibration();
				setMessage("Calibration started. Follow on-screen prompts.", true);
			} catch (error: any) {
				setMessage(`Calibration start failed: ${error.message}`);
			}
		}

		function resizeDisplayCanvas() {
			if (!state.displayCanvas) {
				return;
			}
			state.displayCanvas.width = window.innerWidth;
			state.displayCanvas.height = window.innerHeight;
		}

		function drawCalibrationScene(
			ctx: CanvasRenderingContext2D,
			width: number,
			height: number,
			timestamp: number,
		) {
			ctx.fillStyle = "#03060d";
			ctx.fillRect(0, 0, width, height);
			ctx.strokeStyle = "rgba(255,255,255,0.04)";
			ctx.lineWidth = 1;
			for (let x = 0; x <= width; x += 160) {
				ctx.beginPath();
				ctx.moveTo(x, 0);
				ctx.lineTo(x, height);
				ctx.stroke();
			}
			for (let y = 0; y <= height; y += 160) {
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(width, y);
				ctx.stroke();
			}
			state.calibrationPoints.forEach((point, index) => {
				const cx = point.nx * width;
				const cy = point.ny * height;
				if (index < state.calibrationIndex) {
					ctx.fillStyle = "#2ecc71";
					ctx.beginPath();
					ctx.arc(cx, cy, 18, 0, Math.PI * 2);
					ctx.fill();
				} else if (index === state.calibrationIndex) {
					const pulse = 20 + Math.sin(timestamp / 200) * 6;
					ctx.strokeStyle = "#f1c40f";
					ctx.lineWidth = 4;
					ctx.beginPath();
					ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
					ctx.stroke();
					ctx.fillStyle = "rgba(241,196,15,0.5)";
					ctx.beginPath();
					ctx.arc(cx, cy, 18, 0, Math.PI * 2);
					ctx.fill();
				} else {
					ctx.fillStyle = "#34495e";
					ctx.beginPath();
					ctx.arc(cx, cy, 10, 0, Math.PI * 2);
					ctx.fill();
				}
			});
			if (state.isCapturing) {
				const elapsed = (performance.now() - state.captureStart) / 1000;
				const progress = Math.min(1, elapsed / 2.5);
				const point = state.calibrationPoints[state.calibrationIndex];
				if (point) {
					const cx = point.nx * width;
					const cy = point.ny * height;
					ctx.strokeStyle = "rgba(39,174,96,0.9)";
					ctx.lineWidth = 6;
					ctx.beginPath();
					ctx.arc(cx, cy, 60, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
					ctx.stroke();
				}
			}
		}

		function drawTrackingScene(ctx: CanvasRenderingContext2D, width: number, height: number) {
			ctx.fillStyle = "#020408";
			ctx.fillRect(0, 0, width, height);
			ctx.strokeStyle = "rgba(255,255,255,0.06)";
			ctx.lineWidth = 1;
			for (let x = 0; x <= width; x += 140) {
				ctx.beginPath();
				ctx.moveTo(x, 0);
				ctx.lineTo(x, height);
				ctx.stroke();
			}
			for (let y = 0; y <= height; y += 140) {
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(width, y);
				ctx.stroke();
			}
			ctx.strokeStyle = "rgba(255,255,255,0.18)";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(width / 2, 0);
			ctx.lineTo(width / 2, height);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(0, height / 2);
			ctx.lineTo(width, height / 2);
			ctx.stroke();
			if (state.trackingHistory.length > 1) {
				ctx.strokeStyle = "rgba(46, 204, 113, 0.45)";
				ctx.lineWidth = 4;
				ctx.beginPath();
				state.trackingHistory.forEach((point, index) => {
					if (index === 0) {
						ctx.moveTo(point.x, point.y);
					} else {
						ctx.lineTo(point.x, point.y);
					}
				});
				ctx.stroke();
			}
			if (state.trackingDot) {
				const { x, y } = state.trackingDot;
				ctx.fillStyle = "rgba(12, 255, 173, 0.3)";
				ctx.beginPath();
				ctx.arc(x, y, 32, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = "#0affad";
				ctx.beginPath();
				ctx.arc(x, y, 18, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = "#ffffff";
				ctx.beginPath();
				ctx.arc(x, y, 6, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		function renderDisplay(timestamp: number) {
			if (!state.displayCanvas || !state.displayCtx) {
				return;
			}
			const width = state.displayCanvas.width;
			const height = state.displayCanvas.height;
			state.displayCtx.clearRect(0, 0, width, height);
			if (state.displayMode === "calibration") {
				drawCalibrationScene(state.displayCtx, width, height, timestamp);
			} else if (state.displayMode === "tracking") {
				drawTrackingScene(state.displayCtx, width, height);
			}
			state.displayAnimation = window.requestAnimationFrame(renderDisplay);
		}

		function enterDisplayMode(mode: "calibration" | "tracking") {
			state.displayMode = mode;
			const layer = document.getElementById("display-layer");
			if (layer) {
				layer.classList.add("active");
				layer.classList.remove("hidden");
				layer.classList.add("flex");
			}
			resizeDisplayCanvas();
			if (!document.fullscreenElement) {
				document.documentElement.requestFullscreen?.().catch(() => {});
			}
			window.cancelAnimationFrame(state.displayAnimation);
			renderDisplay(performance.now());
			if (mode === "tracking") {
				startGazePolling();
				setSiteOverlayDisabled(false);
			} else {
				stopGazePolling();
				setSiteOverlayDisabled(true);
			}
		}

		function leaveDisplayMode() {
			stopGazePolling();
			window.cancelAnimationFrame(state.displayAnimation);
			const layer = document.getElementById("display-layer");
			if (layer) {
				layer.classList.remove("active");
				layer.classList.remove("flex");
				layer.classList.add("hidden");
			}
			setSiteOverlayDisabled(true);
			if (document.fullscreenElement) {
				document.exitFullscreen?.();
			}
		}

		async function captureCalibration(skip = false) {
			const total = state.calibrationPoints.length;
			if (skip) {
				state.calibrationIndex = Math.min(total - 1, state.calibrationIndex + 1);
				document.getElementById("display-instructions")!.textContent = `Point ${state.calibrationIndex + 1} / ${total}`;
				return;
			}
			const point = state.calibrationPoints[state.calibrationIndex];
			if (!point) {
				return;
			}
			state.isCapturing = true;
			state.captureStart = performance.now();
			const primary = document.getElementById("display-primary") as HTMLButtonElement | null;
			const secondary = document.getElementById("display-secondary") as HTMLButtonElement | null;
			if (primary) primary.disabled = true;
			if (secondary) secondary.disabled = true;
			document.getElementById("display-instructions")!.textContent = "Collecting samples… hold gaze steady";
			try {
				await fetchJSON("/api/calibration/capture", {
					method: "POST",
					body: JSON.stringify({
						point_index: state.calibrationIndex,
						screen_x: point.x,
						screen_y: point.y,
					}),
				});
				state.calibrationCollected += 1;
				state.calibrationIndex += 1;
				const totalPoints = state.calibrationPoints.length;
				if (state.calibrationIndex >= totalPoints) {
					document.getElementById("display-instructions")!.textContent = "All points captured · finalize calibration";
					setDisplayButtonsForFinalize();
				} else {
					document.getElementById("display-instructions")!.textContent = `Point ${state.calibrationIndex + 1} / ${totalPoints}`;
					if (primary) primary.disabled = false;
					if (secondary) secondary.disabled = false;
				}
			} catch (error: any) {
				setMessage(`Calibration capture failed: ${error.message}`);
				if (primary) primary.disabled = false;
				if (secondary) secondary.disabled = false;
			} finally {
				state.isCapturing = false;
			}
		}

		function setDisplayButtonsForCalibration() {
			const primary = document.getElementById("display-primary") as HTMLButtonElement | null;
			const secondary = document.getElementById("display-secondary") as HTMLButtonElement | null;
			const tertiary = document.getElementById("display-tertiary") as HTMLButtonElement | null;
			if (!primary || !secondary || !tertiary) {
				return;
			}
			primary.textContent = "Capture";
			secondary.textContent = "Skip";
			tertiary.textContent = "Abort";
			primary.disabled = false;
			secondary.disabled = false;
			tertiary.disabled = false;
			document.getElementById("display-instructions")!.textContent = `Point 1 / ${state.calibrationPoints.length}`;
			setSiteOverlayDisabled(true);
		}

		function setDisplayButtonsForFinalize() {
			const primary = document.getElementById("display-primary") as HTMLButtonElement | null;
			const secondary = document.getElementById("display-secondary") as HTMLButtonElement | null;
			const tertiary = document.getElementById("display-tertiary") as HTMLButtonElement | null;
			if (!primary || !secondary || !tertiary) {
				return;
			}
			primary.textContent = "Finalize";
			secondary.textContent = "Recalibrate";
			tertiary.textContent = "Exit";
			primary.disabled = false;
			secondary.disabled = false;
			tertiary.disabled = false;
			setSiteOverlayDisabled(true);
		}

		async function finalizeCalibration() {
			if (!state.calibrationScreen) {
				return;
			}
			try {
				await fetchJSON("/api/calibration/finish", {
					method: "POST",
					body: JSON.stringify({
						screen_width: state.calibrationScreen.width,
						screen_height: state.calibrationScreen.height,
					}),
				});
				persistCalibration(state.calibrationScreen);
				leaveDisplayMode();
				setStep("params");
				state.trackingAvailable = true;
				updateTrackingButton();
				setMessage("Calibration complete. Use ‘Show Tracking Overlay’ when ready.", true);
			} catch (error: any) {
				setMessage(`Calibration finalize failed: ${error.message}`);
			}
		}

		function setDisplayButtonsForTracking() {
			const primary = document.getElementById("display-primary") as HTMLButtonElement | null;
			const secondary = document.getElementById("display-secondary") as HTMLButtonElement | null;
			const tertiary = document.getElementById("display-tertiary") as HTMLButtonElement | null;
			if (!primary || !secondary || !tertiary) {
				return;
			}
			primary.textContent = "Exit Tracking";
			secondary.textContent = "Recalibrate";
			tertiary.textContent = "Stop Session";
			primary.disabled = false;
			secondary.disabled = false;
			tertiary.disabled = false;
			document.getElementById("display-instructions")!.textContent = "Live gaze tracking";
			lockDisplayActions(600);
			setSiteOverlayDisabled(false);
		}

		function prepareSiteOverlayNavigation() {
			try {
				persistBackendUrl(state.backendUrl);
				persistCalibration(state.calibrationScreen);
				localStorage.setItem(OVERLAY_ENABLED_KEY, "true");
				dispatchOverlayUpdate();
				setMessage("Site overlay enabled. Navigate with gaze tracking.", true);
				leaveDisplayMode();
				window.setTimeout(() => {
					window.location.assign("/");
				}, 160);
			} catch (error: any) {
				setMessage(`Unable to enable site overlay: ${error.message || error}`, false);
			}
		}

		function startGazePolling() {
			stopGazePolling();
			state.gazePoll = window.setInterval(pollGazeData, 120);
		}

		async function pollGazeData() {
			try {
				const data = await fetchJSON("/api/gaze");
				let px: number | null = null;
				let py: number | null = null;

				if (data.calibrated_position && state.calibrationScreen && state.displayCanvas) {
					const scaleX = state.displayCanvas.width / state.calibrationScreen.width;
					const scaleY = state.displayCanvas.height / state.calibrationScreen.height;
					px = data.calibrated_position.x * scaleX;
					py = data.calibrated_position.y * scaleY;
				} else if (data.normalized_pupil && state.displayCanvas) {
					px = data.normalized_pupil.x * state.displayCanvas.width;
					py = data.normalized_pupil.y * state.displayCanvas.height;
				}

				if (px === null || py === null || Number.isNaN(px) || Number.isNaN(py) || !state.displayCanvas) {
					state.trackingDot = null;
					return;
				}

				px = Math.max(12, Math.min(state.displayCanvas.width - 12, px));
				py = Math.max(12, Math.min(state.displayCanvas.height - 12, py));

				state.trackingDot = { x: px, y: py };
				state.trackingHistory.push(state.trackingDot);
				if (state.trackingHistory.length > state.trackingMaxHistory) {
					state.trackingHistory.shift();
				}
			} catch (error) {
				// swallow transient fetch issues
			}
		}

		async function stopSession() {
			stopGazePolling();
			closePreviewSocket();
			try {
				await fetchJSON("/api/stop", { method: "POST" });
			} catch (error) {
				console.warn("Stop session", error);
			}
			leaveDisplayMode();
			setStep("source");
			setMessage("Session stopped", true);
			state.latestPupilMask = null;
			state.latestGlintMask = null;
			state.serverRoi = null;
			state.trackingAvailable = false;
			updateTrackingButton();
			clearMaskCanvas(
				state.pupilMaskCanvas,
				state.pupilMaskCtx,
				state.pupilMaskLabel,
				"No data yet · define ROI",
			);
			clearMaskCanvas(
				state.glintMaskCanvas,
				state.glintMaskCtx,
				state.glintMaskLabel,
				"No data yet · define ROI",
			);
		}

		async function startSource(source: string) {
			try {
				const result = await fetchJSON("/api/start", {
					method: "POST",
					body: JSON.stringify({ source }),
				});
				const statusInput = document.getElementById("backend-status") as HTMLInputElement | null;
				if (statusInput) statusInput.value = "running";
				if (result?.status === "already-running") {
					setMessage("Video source already running", true);
				} else if (result?.status === "restarted") {
					setMessage("Video source restarted", true);
				} else {
					setMessage("Video source started", true);
				}
				state.activeRoiRect = null;
				state.pendingRoiFrame = null;
				state.serverRoi = null;
				state.trackingAvailable = false;
				updateTrackingButton();
				const applyBtn = document.getElementById("roi-apply") as HTMLButtonElement | null;
				const nextBtn = document.getElementById("roi-next") as HTMLButtonElement | null;
				if (applyBtn) applyBtn.disabled = true;
				if (nextBtn) nextBtn.disabled = true;
				state.latestPupilMask = null;
				state.latestGlintMask = null;
				clearMaskCanvas(state.pupilMaskCanvas, state.pupilMaskCtx, state.pupilMaskLabel, "Waiting for preview…");
				clearMaskCanvas(state.glintMaskCanvas, state.glintMaskCtx, state.glintMaskLabel, "Waiting for preview…");
				ensurePreviewSocket();
				setStep("roi");
			} catch (error: any) {
				setMessage(`Unable to start source: ${error.message}`);
			}
		}

		async function startUsbSetup() {
			const backendInput = document.getElementById("backend-url") as HTMLInputElement | null;
			const usbInput = document.getElementById("usb-index") as HTMLInputElement | null;
			state.backendUrl = backendInput?.value.trim() || state.backendUrl;
			persistBackendUrl(state.backendUrl);
			const source = String(usbInput?.value.trim() || "0");
			await startSource(source);
		}

		async function startStreamSetup() {
			const backendInput = document.getElementById("backend-url") as HTMLInputElement | null;
			const sourceInput = document.getElementById("stream-url") as HTMLInputElement | null;
			state.backendUrl = backendInput?.value.trim() || state.backendUrl;
			persistBackendUrl(state.backendUrl);
			const source = sourceInput?.value.trim();
			if (!source) {
				setMessage("Enter a stream URL");
				return;
			}
			await startSource(source);
		}

		async function refreshBackendStatus(autoNavigate = false) {
			const backendInput = document.getElementById("backend-url") as HTMLInputElement | null;
			state.backendUrl = backendInput?.value.trim() || state.backendUrl;
			persistBackendUrl(state.backendUrl);
			try {
				const status = await fetchJSON("/api/status");
				const running = Boolean(status.running);
				const statusInput = document.getElementById("backend-status") as HTMLInputElement | null;
				if (statusInput) statusInput.value = running ? "running" : "idle";
				if (state.resumeButton) {
					state.resumeButton.style.display = running ? "inline-flex" : "none";
				}

				if (running) {
					const calibrationLoaded = Boolean(status.calibration_loaded);
					state.trackingAvailable = calibrationLoaded;
					updateTrackingButton();
					setMessage("Backend reachable", true);
					if (Array.isArray(status.roi) && status.roi.length === 4) {
						const roi = {
							x: Number(status.roi[0]) || 0,
							y: Number(status.roi[1]) || 0,
							width: Number(status.roi[2]) || 0,
							height: Number(status.roi[3]) || 0,
						};
						state.serverRoi = roi;
						state.pendingRoiFrame = roi;
						updateRoiInputs(roi);
						const nextBtn = document.getElementById("roi-next") as HTMLButtonElement | null;
						const applyBtn = document.getElementById("roi-apply") as HTMLButtonElement | null;
						if (nextBtn) nextBtn.disabled = false;
						if (applyBtn) applyBtn.disabled = false;
					} else {
						state.serverRoi = null;
						const nextBtn = document.getElementById("roi-next") as HTMLButtonElement | null;
						const applyBtn = document.getElementById("roi-apply") as HTMLButtonElement | null;
						if (nextBtn) nextBtn.disabled = true;
						if (applyBtn) applyBtn.disabled = true;
					}

					if (autoNavigate && state.currentStep === "source") {
						ensurePreviewSocket();
						setStep(state.serverRoi ? "params" : "roi");
					}
				} else {
					if (state.resumeButton) {
						state.resumeButton.style.display = "none";
					}
					state.serverRoi = null;
					if (autoNavigate && state.currentStep !== "source") {
						setStep("source");
					}
					setMessage("Backend idle");
					state.trackingAvailable = false;
					updateTrackingButton();
				}
			} catch (error: any) {
				setMessage(`Backend check failed: ${error.message}`);
				const statusInput = document.getElementById("backend-status") as HTMLInputElement | null;
				if (statusInput) statusInput.value = "offline";
				if (state.resumeButton) {
					state.resumeButton.style.display = "none";
				}
				state.serverRoi = null;
				state.trackingAvailable = false;
				updateTrackingButton();
			}
		}

		async function fetchJSON(path: string, options: RequestInit = {}) {
			const url = new URL(path, state.backendUrl);
			const response = await fetch(url.toString(), {
				method: options.method || "GET",
				headers: {
					"Content-Type": "application/json",
					...(options.headers || {}),
				},
				body: options.body,
			});
			if (!response.ok) {
				const text = await response.text();
				throw new Error(text || `${response.status} ${response.statusText}`);
			}
			if (response.status === 204) {
				return null;
			}
			return response.json();
		}

		function addEventListeners() {
			if (!state.previewCanvas) {
				return;
			}
			const pointerDownHandler = (event: PointerEvent) => {
				event.preventDefault();
				beginRoiSelection(event);
			};
			state.previewCanvas.addEventListener("pointerdown", pointerDownHandler);
			cleanupFns.push(() => state.previewCanvas?.removeEventListener("pointerdown", pointerDownHandler));

			const pointerMoveHandler = (event: PointerEvent) => {
				if (!state.drawingRoi) {
					return;
				}
				event.preventDefault();
				updateRoiSelection(event);
			};
			state.previewCanvas.addEventListener("pointermove", pointerMoveHandler);
			cleanupFns.push(() => state.previewCanvas?.removeEventListener("pointermove", pointerMoveHandler));

			const pointerUpHandler = (event: PointerEvent) => {
				event.preventDefault();
				finishRoiSelection();
			};
			state.previewCanvas.addEventListener("pointerup", pointerUpHandler);
			cleanupFns.push(() => state.previewCanvas?.removeEventListener("pointerup", pointerUpHandler));

			const pointerLeaveHandler = () => {
				if (state.drawingRoi) {
					finishRoiSelection();
				}
			};
			state.previewCanvas.addEventListener("pointerleave", pointerLeaveHandler);
			cleanupFns.push(() => state.previewCanvas?.removeEventListener("pointerleave", pointerLeaveHandler));

			const dblClickHandler = () => {
				state.activeRoiRect = null;
				state.pendingRoiFrame = null;
				const applyBtn = document.getElementById("roi-apply") as HTMLButtonElement | null;
				const nextBtn = document.getElementById("roi-next") as HTMLButtonElement | null;
				if (applyBtn) applyBtn.disabled = true;
				if (nextBtn) nextBtn.disabled = true;
				setMessage("ROI reset");
			};
			state.previewCanvas.addEventListener("dblclick", dblClickHandler);
			cleanupFns.push(() => state.previewCanvas?.removeEventListener("dblclick", dblClickHandler));

			if (state.previewCanvasParams) {
				const clickHandler = (event: MouseEvent) => handlePreviewClick(event);
				state.previewCanvasParams.addEventListener("click", clickHandler);
				cleanupFns.push(() => state.previewCanvasParams?.removeEventListener("click", clickHandler));
			}

			const startUsbBtn = document.getElementById("start-usb");
			if (startUsbBtn) {
				const handler = () => {
					startUsbSetup();
				};
				startUsbBtn.addEventListener("click", handler);
				cleanupFns.push(() => startUsbBtn.removeEventListener("click", handler));
			}

			const startStreamBtn = document.getElementById("start-stream");
			if (startStreamBtn) {
				const handler = () => {
					startStreamSetup();
				};
				startStreamBtn.addEventListener("click", handler);
				cleanupFns.push(() => startStreamBtn.removeEventListener("click", handler));
			}

			const refreshBtn = document.getElementById("refresh-status");
			if (refreshBtn) {
				const handler = () => {
					refreshBackendStatus();
				};
				refreshBtn.addEventListener("click", handler);
				cleanupFns.push(() => refreshBtn.removeEventListener("click", handler));
			}

			if (state.resumeButton) {
				const handler = () => {
					ensurePreviewSocket();
					setStep("roi");
					setMessage("Resumed ROI setup", true);
				};
				state.resumeButton.addEventListener("click", handler);
				cleanupFns.push(() => state.resumeButton?.removeEventListener("click", handler));
			}

			const roiBackBtn = document.getElementById("roi-back");
			if (roiBackBtn) {
				const handler = () => {
					setStep("source");
					setMessage("Choose a different video source.", true);
				};
				roiBackBtn.addEventListener("click", handler);
				cleanupFns.push(() => roiBackBtn.removeEventListener("click", handler));
			}

			const roiApplyBtn = document.getElementById("roi-apply");
			if (roiApplyBtn) {
				const handler = () => {
					applyRoi();
				};
				roiApplyBtn.addEventListener("click", handler);
				cleanupFns.push(() => roiApplyBtn.removeEventListener("click", handler));
			}

			const roiFullFrameBtn = document.getElementById("roi-fullframe");
			if (roiFullFrameBtn) {
				const handler = () => {
					useFullFrame();
				};
				roiFullFrameBtn.addEventListener("click", handler);
				cleanupFns.push(() => roiFullFrameBtn.removeEventListener("click", handler));
			}

			const roiNextBtn = document.getElementById("roi-next");
			if (roiNextBtn) {
				const handler = () => {
					setStep("params");
				};
				roiNextBtn.addEventListener("click", handler);
				cleanupFns.push(() => roiNextBtn.removeEventListener("click", handler));
			}

			const paramsBackBtn = document.getElementById("params-back");
			if (paramsBackBtn) {
				const handler = () => {
					setStep("roi");
				};
				paramsBackBtn.addEventListener("click", handler);
				cleanupFns.push(() => paramsBackBtn.removeEventListener("click", handler));
			}

			const saveParamsBtn = document.getElementById("save-params");
			if (saveParamsBtn) {
				const handler = () => {
					sendParameterUpdate();
				};
				saveParamsBtn.addEventListener("click", handler);
				cleanupFns.push(() => saveParamsBtn.removeEventListener("click", handler));
			}

			const pickPupilBtn = document.getElementById("pick-pupil");
			if (pickPupilBtn) {
				const handler = () => {
					setPickMode("pupil");
				};
				pickPupilBtn.addEventListener("click", handler);
				cleanupFns.push(() => pickPupilBtn.removeEventListener("click", handler));
			}

			const pickGlintBtn = document.getElementById("pick-glint");
			if (pickGlintBtn) {
				const handler = () => {
					setPickMode("glint");
				};
				pickGlintBtn.addEventListener("click", handler);
				cleanupFns.push(() => pickGlintBtn.removeEventListener("click", handler));
			}

			const calibrationBtn = document.getElementById("to-calibration");
			if (calibrationBtn) {
				const handler = () => {
					startCalibration();
				};
				calibrationBtn.addEventListener("click", handler);
				cleanupFns.push(() => calibrationBtn.removeEventListener("click", handler));
			}

			if (state.showTrackingButton) {
				const handler = () => {
					runDisplayAction(async () => {
						enterDisplayMode("tracking");
						setDisplayButtonsForTracking();
					});
				};
				state.showTrackingButton.addEventListener("click", handler);
				cleanupFns.push(() => state.showTrackingButton?.removeEventListener("click", handler));
			}

			const displayPrimary = document.getElementById("display-primary");
			if (displayPrimary) {
				const handler = () => {
					runDisplayAction(async () => {
						if (state.displayMode === "calibration" && state.calibrationIndex >= state.calibrationPoints.length) {
							await finalizeCalibration();
							return;
						}
						if (state.displayMode === "calibration") {
							await captureCalibration(false);
							return;
						}
						if (state.displayMode === "tracking") {
							leaveDisplayMode();
							setStep("params");
							state.trackingAvailable = true;
							updateTrackingButton();
						}
					});
				};
				displayPrimary.addEventListener("click", handler);
				cleanupFns.push(() => displayPrimary.removeEventListener("click", handler));
			}

			const displaySecondary = document.getElementById("display-secondary");
			if (displaySecondary) {
				const handler = () => {
					runDisplayAction(async () => {
						if (state.displayMode === "calibration" && state.calibrationIndex >= state.calibrationPoints.length) {
							await startCalibration();
							return;
						}
						if (state.displayMode === "calibration") {
							await captureCalibration(true);
							return;
						}
						if (state.displayMode === "tracking") {
							await startCalibration();
						}
					});
				};
				displaySecondary.addEventListener("click", handler);
				cleanupFns.push(() => displaySecondary.removeEventListener("click", handler));
			}

			const displayTertiary = document.getElementById("display-tertiary");
			if (displayTertiary) {
				const handler = () => {
					runDisplayAction(async () => {
						if (state.displayMode === "tracking") {
							await stopSession();
						} else {
							leaveDisplayMode();
							setStep("params");
							state.trackingAvailable = true;
							updateTrackingButton();
						}
					});
				};
				displayTertiary.addEventListener("click", handler);
				cleanupFns.push(() => displayTertiary.removeEventListener("click", handler));
			}

			const displayHome = document.getElementById("display-site-overlay");
			if (displayHome) {
				const handler = () => {
					runDisplayAction(async () => {
						if (state.displayMode !== "tracking") {
							setMessage("Complete calibration to use the site overlay.");
							return;
						}
						prepareSiteOverlayNavigation();
					});
				};
				displayHome.addEventListener("click", handler);
				cleanupFns.push(() => displayHome.removeEventListener("click", handler));
			}

			const resizeHandler = () => {
				resizeDisplayCanvas();
			};
			window.addEventListener("resize", resizeHandler);
			cleanupFns.push(() => window.removeEventListener("resize", resizeHandler));
		}

		function initCanvases() {
			state.previewCanvas = document.getElementById("preview-canvas") as HTMLCanvasElement | null;
			state.previewCtx = state.previewCanvas?.getContext("2d") ?? null;
			state.previewCanvasParams = document.getElementById("preview-canvas-params") as HTMLCanvasElement | null;
			state.previewCtxParams = state.previewCanvasParams?.getContext("2d") ?? null;
			state.offscreenCtx = state.offscreen.getContext("2d");
			state.displayCanvas = document.getElementById("display-canvas") as HTMLCanvasElement | null;
			state.displayCtx = state.displayCanvas?.getContext("2d") ?? null;
			state.pupilMaskCanvas = document.getElementById("pupil-mask-canvas") as HTMLCanvasElement | null;
			state.pupilMaskCtx = state.pupilMaskCanvas?.getContext("2d") ?? null;
			state.glintMaskCanvas = document.getElementById("glint-mask-canvas") as HTMLCanvasElement | null;
			state.glintMaskCtx = state.glintMaskCanvas?.getContext("2d") ?? null;
			state.pupilMaskLabel = document.getElementById("pupil-mask-empty") as HTMLDivElement | null;
			state.glintMaskLabel = document.getElementById("glint-mask-empty") as HTMLDivElement | null;
			state.resumeButton = document.getElementById("resume-setup") as HTMLButtonElement | null;
			state.showTrackingButton = document.getElementById("show-tracking") as HTMLButtonElement | null;
		}

		function init() {
			try {
				const savedBackend = localStorage.getItem(BACKEND_URL_STORAGE_KEY);
				if (savedBackend) {
					state.backendUrl = savedBackend;
					const backendInput = document.getElementById("backend-url") as HTMLInputElement | null;
					if (backendInput) {
						backendInput.value = savedBackend;
					}
				}
			} catch (error) {
				console.warn("Restore backend URL", error);
			}
			initCanvases();
			addEventListeners();
			initParameterControls();
			refreshBackendStatus(true);
			if (state.previewCtx && state.previewCanvas) {
				state.previewCtx.fillStyle = "#091018";
				state.previewCtx.fillRect(0, 0, state.previewCanvas.width, state.previewCanvas.height);
			}
			if (state.previewCtxParams && state.previewCanvasParams) {
				state.previewCtxParams.fillStyle = "#091018";
				state.previewCtxParams.fillRect(0, 0, state.previewCanvasParams.width, state.previewCanvasParams.height);
			}
			clearMaskCanvas(state.pupilMaskCanvas, state.pupilMaskCtx, state.pupilMaskLabel, "No data yet · define ROI");
			clearMaskCanvas(state.glintMaskCanvas, state.glintMaskCtx, state.glintMaskLabel, "No data yet · define ROI");
			updateTrackingButton();
		}

		init();

		return () => {
			cleanupFns.forEach((fn) => fn());
			stopGazePolling();
			closePreviewSocket();
			if (state.parameterDebounce) {
				window.clearTimeout(state.parameterDebounce);
			}
			if (state.messageTimer) {
				window.clearTimeout(state.messageTimer);
			}
			if (state.visibilityTimeout) {
				window.clearTimeout(state.visibilityTimeout);
			}
			window.cancelAnimationFrame(state.displayAnimation);
		};
	}, []);

	const stepContainerClasses =
		"step w-full max-w-[980px] flex-col gap-6 rounded-[18px] border border-white/10 bg-[#10171f]/95 p-8 shadow-[0_20px_45px_rgba(0,0,0,0.45)] backdrop-blur";
	const subCardClasses = "rounded-[14px] border border-white/5 bg-[#111923]/85 p-5";
	const secondaryCardClasses = "rounded-[14px] border border-white/10 bg-[#0a1017]/90 p-5";
	const labelClasses = "mb-1 text-xs font-semibold uppercase tracking-[0.32em] text-[#8fa1b8]";
	const inputClasses =
		"w-full rounded-lg border border-white/10 bg-[#0c121b]/90 px-3 py-2.5 text-sm text-[#eaeff6] placeholder:text-slate-500 focus:border-[#5f82ff]/60 focus:outline-none focus:ring-2 focus:ring-[#5f82ff]/40 disabled:opacity-60";
	const previewWrapperClasses =
		"preview-wrapper relative w-full overflow-hidden rounded-[18px] border border-white/10 bg-black/80 shadow-[inset_0_0_40px_rgba(0,0,0,0.35)]";
	const overlayTextClasses =
		"absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3.5 py-2 text-xs font-medium uppercase tracking-[0.26em] text-[#eaeff6]";
	const maskCardClasses = "rounded-[14px] border border-white/10 bg-[#0c121b]/90 p-4";
	const maskTitleClasses = "text-xs font-semibold uppercase tracking-[0.32em] text-[#8fa1b8]";
	const maskCanvasClasses = "h-auto w-full rounded-lg border border-white/10 bg-[#05090f]";
	const maskEmptyClasses = "text-center text-sm text-[#536070]";
	const toolbarClasses = "flex flex-wrap items-center gap-3";
	const buttonBase =
		"rounded-full px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.28em] transition disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5f82ff]/50";
	const buttonPrimary =
		`${buttonBase} bg-gradient-to-br from-[#5f82ff] to-[#7d5bff] text-white shadow-[0_12px_28px_rgba(95,130,255,0.32)] hover:-translate-y-[1px] hover:shadow-[0_16px_36px_rgba(95,130,255,0.38)]`;
	const buttonSecondary = `${buttonBase} border border-white/15 bg-white/10 text-[#eaeff6] hover:bg-white/15`;
	const buttonGhost = `${buttonBase} border border-white/25 bg-transparent text-[#eaeff6] hover:bg-white/10`;
	const headingText = "font-semibold uppercase tracking-[0.18em] text-[#eaeff6]";
	const subheadingText = "text-sm text-[#b0c2d6] leading-6";

	return (
		<div className="min-h-screen bg-[#0b0f16] text-[#eaeff6]">
			<div id="app" className="mx-auto flex min-h-screen w-full flex-col items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
				<section className={`${stepContainerClasses} flex active`} data-step="source">
					<div className="space-y-2">
						<h1 className={`${headingText} text-2xl`}>IR Eye Tracker Setup</h1>
						<p className={subheadingText}>
							Step through source selection, ROI, threshold tuning, and calibration just like the desktop UI. Start the Python backend before continuing.
						</p>
					</div>
					<div className={`${secondaryCardClasses} space-y-5`}>
						<h2 className={`${headingText} text-lg`}>1 · Choose Backend &amp; Source</h2>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<label className={labelClasses} htmlFor="backend-url">
									Backend URL
								</label>
								<input
									type="text"
									id="backend-url"
									defaultValue="http://localhost:8000"  
									className={inputClasses}
								/>
							</div>
							<div className="space-y-2">
								<label className={labelClasses} htmlFor="backend-status">
									Backend status
								</label>
								<input type="text" id="backend-status" defaultValue="disconnected" disabled className={inputClasses} />
							</div>
						</div>
						<div className={`${subCardClasses} space-y-4`}
						>
							<p className={subheadingText}>Select how you want to capture the eye video.</p>
							<div className="grid gap-4 sm:grid-cols-2">
								<div className="space-y-3">
									<label className={labelClasses} htmlFor="usb-index">
										USB / built-in camera index
									</label>
									<input type="number" id="usb-index" defaultValue="0" min={0} className={inputClasses} />
									<div className={toolbarClasses}>
										<button id="start-usb" className={buttonPrimary}>
											Start USB Setup
										</button>
									</div>
								</div>
								<div className="space-y-3">
									<label className={labelClasses} htmlFor="stream-url">
										Network stream (MJPEG / RTSP)
									</label>
									<input type="text" id="stream-url" placeholder="http://camera-ip:port/stream" className={inputClasses} />
									<div className={toolbarClasses}>
										<button id="start-stream" className={buttonSecondary}>
											Start Stream Setup
										</button>
									</div>
								</div>
							</div>
						</div>
						<div className={toolbarClasses}>
							<button id="refresh-status" className={buttonSecondary}>
								Check Backend
							</button>
							<button id="resume-setup" className={buttonSecondary} style={{ display: "none" }}>
								Resume ROI Setup
							</button>
						</div>
					</div>
				</section>
				<section className={`${stepContainerClasses} hidden`} data-step="roi">
					<div className="space-y-2">
						<h2 className={`${headingText} text-lg`}>2 · Select Eye ROI</h2>
						<p className={subheadingText}>
							Drag a rectangle around the eye within the live preview. Wireless feeds stream over WebSocket for low-latency selection.
						</p>
					</div>
					<div className={previewWrapperClasses}>
						<canvas id="preview-canvas" className="h-auto w-full" width={960} height={540}></canvas>
						<div className={overlayTextClasses}>Drag to define the crop region · double-click to reset</div>
					</div>
					<div className={`${secondaryCardClasses} space-y-5`}>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<div className="space-y-2">
								<label className={labelClasses} htmlFor="roi-x">
									X
								</label>
								<input type="number" id="roi-x" min={0} className={inputClasses} />
							</div>
							<div className="space-y-2">
								<label className={labelClasses} htmlFor="roi-y">
									Y
								</label>
								<input type="number" id="roi-y" min={0} className={inputClasses} />
							</div>
							<div className="space-y-2">
								<label className={labelClasses} htmlFor="roi-width">
									Width
								</label>
								<input type="number" id="roi-width" min={1} className={inputClasses} />
							</div>
							<div className="space-y-2">
								<label className={labelClasses} htmlFor="roi-height">
									Height
								</label>
								<input type="number" id="roi-height" min={1} className={inputClasses} />
							</div>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className={toolbarClasses}>
								<button id="roi-back" className={buttonSecondary}>
									Back to Source
								</button>
								<button id="roi-apply" className={buttonPrimary} disabled>
									Apply ROI
								</button>
								<button id="roi-fullframe" className={buttonSecondary}>
									Use Full Frame
								</button>
							</div>
							<button id="roi-next" className={`${buttonSecondary} w-full sm:w-auto`} disabled>
								Continue to Thresholds
							</button>
						</div>
					</div>
				</section>
				<section className={`${stepContainerClasses} hidden`} data-step="params">
					<div className="space-y-2">
						<h2 className={`${headingText} text-lg`}>3 · Tune Detection Thresholds</h2>
						<p className={subheadingText}>
							Adjust the thresholds or pick pixels directly from the preview (darkest pupil vs brightest glint). The in-frame overlays show the live binary masks so you can confirm the pupil lock before moving on.
						</p>
					</div>
					<div className={previewWrapperClasses}>
						<canvas id="preview-canvas-params" className="h-auto w-full" width={960} height={540}></canvas>
						<div className={overlayTextClasses}>
							Click “Pick Pupil Pixel”, then click the pupil · repeat for glint · overlays show the threshold views
						</div>
					</div>
					<div className={`${secondaryCardClasses} space-y-6`}>
						<div className="grid gap-5 md:grid-cols-2">
							<div className="grid gap-2">
								<div className="flex items-center justify-between text-xs text-[#9fb0c5]">
									<span>Pupil Threshold</span>
									<span id="pupil-thresh-value">50</span>
								</div>
								<input type="range" id="pupil-thresh" min={10} max={200} defaultValue={50} />
								<div className={toolbarClasses}>
									<button id="pick-pupil" className={buttonSecondary}>
										Pick Pupil Pixel
									</button>
								</div>
							</div>
							<div className="grid gap-2">
								<div className="flex items-center justify-between text-xs text-[#9fb0c5]">
									<span>Pupil Blur (odd kernel)</span>
									<span id="pupil-blur-value">3</span>
								</div>
								<input type="range" id="pupil-blur" min={1} max={21} step={2} defaultValue={3} />
							</div>
							<div className="grid gap-2">
								<div className="flex items-center justify-between text-xs text-[#9fb0c5]">
									<span>Glint Threshold</span>
									<span id="glint-thresh-value">240</span>
								</div>
								<input type="range" id="glint-thresh" min={150} max={255} defaultValue={240} />
								<div className={toolbarClasses}>
									<button id="pick-glint" className={buttonSecondary}>
										Pick Glint Pixel
									</button>
								</div>
							</div>
							<div className="grid gap-2">
								<div className="flex items-center justify-between text-xs text-[#9fb0c5]">
									<span>Glint Blur (odd kernel)</span>
									<span id="glint-blur-value">9</span>
								</div>
								<input type="range" id="glint-blur" min={1} max={25} step={2} defaultValue={9} />
							</div>
							<div className="grid gap-2">
								<div className="flex items-center justify-between text-xs text-[#9fb0c5]">
									<span>Ray History</span>
									<span id="ray-history-value">100</span>
								</div>
								<input type="range" id="ray-history" min={30} max={300} defaultValue={100} />
							</div>
							<div className="grid gap-2">
								<div className="flex items-center justify-between text-xs text-[#9fb0c5]">
									<span>Smoothing</span>
									<span id="smoothing-value">0.12</span>
								</div>
								<input type="range" id="smoothing" min={5} max={40} defaultValue={12} />
							</div>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-3">
							<button id="params-back" className={buttonSecondary}>
								Back to ROI
							</button>
							<div className={toolbarClasses}>
								<button id="save-params" className={buttonGhost}>
									Save Parameters
								</button>
								<button id="to-calibration" className={buttonPrimary}>
									Proceed to Calibration
								</button>
								<button id="show-tracking" className={buttonSecondary} disabled>
									Show Tracking Overlay
								</button>
							</div>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className={maskCardClasses}>
								<span className={maskTitleClasses}>Pupil Threshold View</span>
								<canvas id="pupil-mask-canvas" className={maskCanvasClasses} width={240} height={180}></canvas>
								<div className={maskEmptyClasses} id="pupil-mask-empty" data-default="No data yet · define ROI">
									No data yet · define ROI
								</div>
							</div>
							<div className={maskCardClasses}>
								<span className={maskTitleClasses}>Glint Threshold View</span>
								<canvas id="glint-mask-canvas" className={maskCanvasClasses} width={240} height={180}></canvas>
								<div className={maskEmptyClasses} id="glint-mask-empty" data-default="No data yet · define ROI">
									No data yet · define ROI
								</div>
							</div>
						</div>
					</div>
				</section>
			</div>
			<div
				id="message-bar"
				className="mx-auto mb-8 min-h-[52px] w-full max-w-[980px] rounded-xl border border-red-500/25 bg-red-500/20 px-4 py-3 text-sm leading-relaxed text-red-200 transition-colors duration-200"
			>
				Waiting for backend connection…
			</div>
			<div
				id="display-layer"
				className="hidden fixed inset-0 z-50 items-center justify-center bg-[#000c19]"
			>
				<canvas id="display-canvas" className="h-screen w-screen bg-[#04070d]" width={1920} height={1080}></canvas>
				<div id="display-ui" className="pointer-events-none fixed inset-0 flex flex-col justify-between">
					<div id="display-top" className="flex justify-center p-6">
						<div
							id="display-instructions"
							className="pointer-events-auto rounded-full bg-black/60 px-8 py-3 text-sm font-medium uppercase tracking-[0.22em] text-[#d6e4ff]"
						>
							Calibration ready
						</div>
					</div>
					<div id="display-bottom" className="flex justify-center p-6">
						<div id="display-controls" className="pointer-events-auto flex flex-wrap items-center gap-4">
							<button id="display-primary" className={buttonPrimary}>
								Capture
							</button>
							<button id="display-secondary" className={buttonSecondary}>
								Skip
							</button>
							<button id="display-tertiary" className={buttonGhost}>
								Abort
							</button>
							<button id="display-site-overlay" className={buttonSecondary} disabled>
								Open Dashboard
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
