"use client";

import { useEffect, useRef, useState } from "react";

type DotPosition = { x: number; y: number } | null;

type Calibration = { width: number; height: number } | null;

const BACKEND_URL_STORAGE_KEY = "eye-tracker-backend-url";
const CALIBRATION_STORAGE_KEY = "eye-tracker-calibration";
const OVERLAY_ENABLED_KEY = "eye-tracker-overlay-enabled";
const OVERLAY_EVENT_NAME = "eye-tracking-overlay-update";

const highlightClasses = [
	"ring-2",
	"ring-[#0affad]",
	"ring-offset-2",
	"ring-offset-white",
	"dark:ring-offset-gray-950",
	"shadow-[0_0_0_6px_rgba(10,255,173,0.18)]",
];

const DOT_IDLE_POSITION = { x: -9999, y: -9999 } as const;

export default function GazeOverlay() {
	const [enabled, setEnabled] = useState(false);
	const [position, setPosition] = useState<DotPosition>(null);

	const backendRef = useRef<string | null>(null);
	const calibrationRef = useRef<Calibration>(null);
	const pollTimerRef = useRef<number | null>(null);
	const pollingBusyRef = useRef(false);
	const highlightedRef = useRef<HTMLElement | null>(null);

	const clearHighlight = () => {
		const previous = highlightedRef.current;
		if (previous) {
			highlightClasses.forEach((cls) => previous.classList.remove(cls));
			highlightedRef.current = null;
		}
	};

	const applyHighlight = (element: HTMLElement | null) => {
		if (highlightedRef.current === element) {
			return;
		}
		if (!element) {
			clearHighlight();
			return;
		}
		clearHighlight();
		highlightedRef.current = element;
		highlightClasses.forEach((cls) => element.classList.add(cls));
	};

	const syncFromStorage = () => {
		try {
			backendRef.current = localStorage.getItem(BACKEND_URL_STORAGE_KEY);
			const calibrationRaw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
			calibrationRef.current = calibrationRaw ? (JSON.parse(calibrationRaw) as Calibration) : null;
			const overlayEnabled = localStorage.getItem(OVERLAY_ENABLED_KEY) === "true";
			const canEnable = Boolean(overlayEnabled && backendRef.current);
			setEnabled(canEnable);
			if (!canEnable) {
				setPosition(null);
				clearHighlight();
			}
		} catch (error) {
			console.warn("Gaze overlay storage sync", error);
			setEnabled(false);
			setPosition(null);
			clearHighlight();
		}
	};

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		syncFromStorage();

		const handleStorage = (event: StorageEvent) => {
			if (
				event.key === BACKEND_URL_STORAGE_KEY ||
				event.key === CALIBRATION_STORAGE_KEY ||
				event.key === OVERLAY_ENABLED_KEY
			) {
				syncFromStorage();
			}
		};

		const handleOverlayEvent = () => syncFromStorage();

		window.addEventListener("storage", handleStorage);
		window.addEventListener(OVERLAY_EVENT_NAME, handleOverlayEvent);

		return () => {
			window.removeEventListener("storage", handleStorage);
			window.removeEventListener(OVERLAY_EVENT_NAME, handleOverlayEvent);
			if (pollTimerRef.current) {
				window.clearInterval(pollTimerRef.current);
				pollTimerRef.current = null;
			}
			clearHighlight();
		};
	}, []);

	useEffect(() => {
		if (!enabled) {
			if (pollTimerRef.current) {
				window.clearInterval(pollTimerRef.current);
				pollTimerRef.current = null;
			}
			pollingBusyRef.current = false;
			setPosition(null);
			clearHighlight();
			return;
		}

		const pollGaze = async () => {
			if (!enabled || pollingBusyRef.current) {
				return;
			}
			const backendUrl = backendRef.current;
			if (!backendUrl) {
				setEnabled(false);
				return;
			}
			pollingBusyRef.current = true;
			try {
				const url = new URL("/api/gaze", backendUrl);
				const response = await fetch(url.toString(), {
					method: "GET",
					headers: { "Content-Type": "application/json" },
					cache: "no-store",
				});
				if (!response.ok) {
					throw new Error(`${response.status} ${response.statusText}`);
				}
				const data = await response.json();

				let px: number | null = null;
				let py: number | null = null;
				const calibration = calibrationRef.current;

				if (data?.calibrated_position && calibration) {
					const scaleX = window.innerWidth / calibration.width;
					const scaleY = window.innerHeight / calibration.height;
					px = data.calibrated_position.x * scaleX;
					py = data.calibrated_position.y * scaleY;
				} else if (data?.normalized_pupil) {
					px = data.normalized_pupil.x * window.innerWidth;
					py = data.normalized_pupil.y * window.innerHeight;
				}

				if (
					px === null ||
					py === null ||
					Number.isNaN(px) ||
					Number.isNaN(py)
				) {
					setPosition(null);
					applyHighlight(null);
					return;
				}

				const clampedX = Math.max(12, Math.min(window.innerWidth - 12, px));
				const clampedY = Math.max(12, Math.min(window.innerHeight - 12, py));

				setPosition({ x: clampedX, y: clampedY });

				const elementAtPoint = document.elementFromPoint(clampedX, clampedY) as HTMLElement | null;
				const activateTarget = elementAtPoint?.closest<HTMLElement>("[data-gaze-activate]") ?? null;
				applyHighlight(activateTarget);
			} catch (error) {
				setPosition(null);
				applyHighlight(null);
			} finally {
				pollingBusyRef.current = false;
			}
		};

		pollGaze();
		pollTimerRef.current = window.setInterval(pollGaze, 140);

		return () => {
			if (pollTimerRef.current) {
				window.clearInterval(pollTimerRef.current);
				pollTimerRef.current = null;
			}
			pollingBusyRef.current = false;
		};
	}, [enabled]);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat) {
				return;
			}
			const activeElement = event.target as HTMLElement | null;
			if (activeElement && ["INPUT", "TEXTAREA"].includes(activeElement.tagName)) {
				return;
			}
			if (event.code === "Space" || event.key === " ") {
				event.preventDefault();
				const target = highlightedRef.current;
				if (target) {
					target.click();
				}
			} else if (event.key === "Escape") {
				try {
					localStorage.removeItem(OVERLAY_ENABLED_KEY);
					window.dispatchEvent(new CustomEvent(OVERLAY_EVENT_NAME));
				} catch (error) {
					console.warn("Disable overlay via escape", error);
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [enabled]);

	const dotStyle = position
		? { left: `${position.x}px`, top: `${position.y}px` }
		: { left: `${DOT_IDLE_POSITION.x}px`, top: `${DOT_IDLE_POSITION.y}px` };

	return (
		<div className="pointer-events-none fixed inset-0 z-70">
			<div
				className={`absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-[#0affad] shadow-[0_0_18px_rgba(10,255,173,0.45)] transition-opacity duration-100 ${
					enabled && position ? "opacity-100" : "opacity-0"
				}`}
				style={dotStyle}
			/>
		</div>
	);
}
