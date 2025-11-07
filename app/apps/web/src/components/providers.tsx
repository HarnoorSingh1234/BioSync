"use client";

import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SocketProvider } from "./socket-provider";
import OnboardingCheck from "./onboarding-check";
import { useState } from "react";
import GazeOverlay from "./gaze-overlay";

export default function Providers({ 
	children,
	isSignedIn,
}: { 
	children: React.ReactNode;
	isSignedIn: boolean;
}) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 60 * 1000, // 1 minute
						refetchOnWindowFocus: false,
					},
				},
			}),
	);

	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider
				attribute="class"
				defaultTheme="system"
				enableSystem
				disableTransitionOnChange
			>
				<SocketProvider>
					{isSignedIn ? (
						<OnboardingCheck>{children}</OnboardingCheck>
					) : (
						children
					)}
					<GazeOverlay />
					<Toaster richColors />
				</SocketProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
