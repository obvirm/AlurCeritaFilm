import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/ui/components/AppShell";
import { Dashboard } from "@/ui/pages/Dashboard";
import { NewJob } from "@/ui/pages/NewJob";
import { JobDetail } from "@/ui/pages/JobDetail";
import { Templates } from "@/ui/pages/Templates";
import { NotFound } from "@/ui/pages/NotFound";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <AppShell><NotFound /></AppShell>,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/new", element: <NewJob /> },
      { path: "/jobs/:id", element: <JobDetail /> },
      { path: "/templates", element: <Templates /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
