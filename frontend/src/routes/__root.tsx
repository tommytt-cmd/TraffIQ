import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider } from "wagmi";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { wagmiConfig } from "@/services/blockchain/wagmi";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteHeader } from "@/components/site-header";
import { MobileNav } from "@/components/mobile-nav";
import { SiteFooter } from "@/components/site-footer";
import { Toaster } from "@/components/ui/sonner";
import { WalletProvider } from "@/providers";
import { TransactionProvider } from "@/contexts/TransactionContext";
import { TransactionFeed } from "@/components/transaction-feed";

const elyRushWalletTheme = {
  ...lightTheme({
    accentColor: "#b7f34a",
    accentColorForeground: "#15180f",
    borderRadius: "medium",
    fontStack: "system",
    overlayBlur: "small",
  }),
  colors: {
    ...lightTheme().colors,
    accentColor: "#b7f34a",
    accentColorForeground: "#15180f",
    actionButtonBorder: "#171a14",
    actionButtonBorderMobile: "#171a14",
    actionButtonSecondaryBackground: "#e8e7dc",
    closeButton: "#30362a",
    closeButtonBackground: "#e8e7dc",
    connectButtonBackground: "#b7f34a",
    connectButtonText: "#15180f",
    connectionIndicator: "#75b843",
    downloadBottomCardBackground: "#e8e7dc",
    downloadTopCardBackground: "#f5f3e9",
    generalBorder: "#171a14",
    generalBorderDim: "#c9c9b9",
    menuItemBackground: "#e8e7dc",
    modalBackdrop: "rgba(12, 15, 10, 0.72)",
    modalBackground: "#f5f3e9",
    modalBorder: "#171a14",
    modalText: "#171a14",
    modalTextDim: "#626657",
    modalTextSecondary: "#454a3c",
    profileAction: "#e8e7dc",
    profileActionHover: "#dcdece",
    profileForeground: "#171a14",
    selectedOptionBorder: "#9bd632",
  },
  fonts: {
    ...lightTheme().fonts,
    body: '"Chakra Petch", ui-sans-serif, system-ui, sans-serif',
  },
  shadows: {
    ...lightTheme().shadows,
    dialog: "4px 4px 0 #171a14",
    selectedOption: "3px 3px 0 #171a14",
    selectedWallet: "3px 3px 0 #171a14",
  },
};

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ElyRush — Live Vehicle Count Markets" },
      {
        name: "description",
        content:
          "Stake under or over on live junction vehicle counts across betting, locked, live and settling phases.",
      },
      { property: "og:title", content: "ElyRush — Live Vehicle Count Markets" },
      {
        property: "og:description",
        content: "Under/over prediction markets on live traffic camera vehicle counts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider theme={elyRushWalletTheme}>
          <WalletProvider>
            <TransactionProvider>
              <div className="flex min-h-screen flex-col pb-16 md:pb-0">
                <SiteHeader />
                <main className="flex-1">
                  {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
                  <Outlet />
                </main>
                <SiteFooter />
              </div>
              <MobileNav />
              <Toaster />
              <TransactionFeed />
            </TransactionProvider>
          </WalletProvider>
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}


