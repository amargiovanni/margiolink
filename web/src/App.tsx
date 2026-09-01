import { Route, Routes } from "react-router";
import { AppShell } from "./components/layout/AppShell";
import { RequireSession } from "./components/RequireSession";
import Links from "./pages/Links";
import Login from "./pages/Login";

function Placeholder() {
  return <h1 className="font-display text-3xl">MargioLink</h1>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/links"
        element={
          <RequireSession>
            <AppShell>
              <Links />
            </AppShell>
          </RequireSession>
        }
      />
      <Route
        path="/*"
        element={
          <RequireSession>
            <AppShell>
              <Placeholder />
            </AppShell>
          </RequireSession>
        }
      />
    </Routes>
  );
}
