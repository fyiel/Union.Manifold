import { HashRouter, Route, Routes } from "react-router-dom"
import { AppLayout } from "@/app/Layout"
import { LauncherPage } from "@/app/pages/LauncherPage"
import { SearchPage } from "@/app/pages/SearchPage"
import { GameDetailPage } from "@/app/pages/GameDetailPage"
import { LibraryPage } from "@/app/pages/LibraryPage"
import { DownloadsPage } from "@/app/pages/DownloadsPage"
import { SettingsPage } from "@/app/pages/SettingsPage"
import { DownloadsProvider } from "@/context/downloads-context"

export default function App() {
  return (
    <HashRouter>
      <DownloadsProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<LauncherPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/game/:id" element={<GameDetailPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/downloads" element={<DownloadsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </DownloadsProvider>
    </HashRouter>
  )
}
