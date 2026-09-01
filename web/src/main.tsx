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
      // A retried 401 just delays the redirect RequireSession would
      // otherwise show immediately.
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
