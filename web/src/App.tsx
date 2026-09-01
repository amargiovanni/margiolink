import { Route, Routes } from "react-router";
import { RequireSession } from "./components/RequireSession";
import Login from "./pages/Login";

function Placeholder() {
  return (
    <main className="grid min-h-full place-items-center p-8">
      <h1 className="font-display text-3xl">MargioLink</h1>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireSession>
            <Placeholder />
          </RequireSession>
        }
      />
    </Routes>
  );
}
