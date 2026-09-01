import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { ApiError } from "./lib/api";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 is terminal, not transient: it means the session cookie is
      // gone or expired, and no number of retries brings it back. Retrying
      // it only delays the redirect RequireSession would otherwise show
      // immediately. Every other failure keeps the default backoff.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 401) return false;
        return failureCount < 3;
      },
    },
  },
});

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
