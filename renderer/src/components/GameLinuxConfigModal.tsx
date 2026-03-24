import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X, Terminal, FolderOpen, FlaskConical, Cpu } from "lucide-react"
import { LINUX_PRESETS, applyGameLinuxPreset, type LinuxDetectionOption, type LinuxGameConfig, type LinuxPerGameLaunchMode } from "@/lib/linux-presets"

type Props = {
  open: boolean
  appid: string
  gameName?: string
  onClose: () => void
}

export function GameLinuxConfigModal({ open, appid, gameName, onClose }: Props) {
  const [config, setConfig] = useState<GameLinuxConfig>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [slsSteamStatus, setSlsSteamStatus] = useState<{ found: boolean; steamAppId?: string } | null>(null)
  const [slsSteamGlobal, setSlsSteamGlobal] = useState<{ found: boolean } | null>(null)
  const [settingUpSls, setSettingUpSls] = useState(false)
  const [detectedWineVersions, setDetectedWineVersions] = useState<LinuxDetectionOption[]>([])
  const [detectedProtonVersions, setDetectedProtonVersions] = useState<LinuxDetectionOption[]>([])

  useEffect(() => {
    if (!open || !appid) return
    setLoading(true)
    setFeedback(null)
    Promise.all([
      window.ucLinux?.getGameConfig?.(appid),
      window.ucLinux?.slsSteamCheckGame?.(appid),
      window.ucLinux?.detectSLSSteam?.(),
      window.ucLinux?.detectWine?.(),
      window.ucLinux?.detectProton?.(),
    ]).then(([configResult, slsCheck, slsDetect, wineDetect, protonDetect]) => {
      if (configResult?.ok) setConfig((configResult.config as GameLinuxConfig) || {})
      if (slsCheck?.ok) setSlsSteamStatus({ found: slsCheck.found, steamAppId: slsCheck.steamAppId })
      if (slsDetect?.ok) setSlsSteamGlobal({ found: slsDetect.found })
      if (wineDetect?.ok && Array.isArray(wineDetect.versions)) setDetectedWineVersions(wineDetect.versions)
      if (protonDetect?.ok && Array.isArray(protonDetect.versions)) setDetectedProtonVersions(protonDetect.versions)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [open, appid])

  const save = async (next: GameLinuxConfig) => {
    setSaving(true)
    try {
      const result = await window.ucLinux?.setGameConfig?.(appid, next as any)
      if (result?.ok) {
        setFeedback({ type: 'success', message: 'Saved.' })
        setTimeout(() => setFeedback(null), 2000)
      } else {
        setFeedback({ type: 'error', message: result?.error || 'Failed to save.' })
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to save.' })
    } finally {
      setSaving(false)
    }
  }

  const update = (patch: Partial<GameLinuxConfig>) => {
    const next: GameLinuxConfig = { ...config, ...patch }
    setConfig(next)
    save(next)
  }

  const applyPreset = async (presetId: 'auto' | 'native' | 'wine-recommended' | 'proton-recommended') => {
    const next = applyGameLinuxPreset(presetId, config, detectedWineVersions, detectedProtonVersions)
    setConfig(next)
    await save(next)
  }

  const handlePickWineBinary = async () => {
    const result = await window.ucLinux?.pickBinary?.()
    if (result?.ok && result.path) update({ winePath: result.path })
  }

  const handlePickProtonBinary = async () => {
    const result = await window.ucLinux?.pickBinary?.()
    if (result?.ok && result.path) update({ protonPath: result.path })
  }

  const handlePickWinePrefix = async () => {
    const result = await window.ucLinux?.pickPrefixDir?.()
    if (result?.ok && result.path) update({ winePrefix: result.path })
  }

  const handlePickProtonPrefix = async () => {
    const result = await window.ucLinux?.pickPrefixDir?.()
    if (result?.ok && result.path) update({ protonPrefix: result.path })
  }

  const handleSetupSls = async () => {
    if (settingUpSls) return
    setSettingUpSls(true)
    try {
      const result = await window.ucLinux?.slsSteamSetupGame?.(appid, config.slsSteamAppId || '0')
      if (result?.ok) {
        setSlsSteamStatus({ found: true, steamAppId: result.steamAppId })
        setFeedback({ type: 'success', message: `steam_appid.txt written (${result.steamAppId}).` })
      } else {
        setFeedback({ type: 'error', message: result?.error || 'Failed to set up SLSteam.' })
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to set up SLSteam.' })
    } finally {
      setSettingUpSls(false)
      setTimeout(() => setFeedback(null), 3000)
    }
  }

  const handleReset = async () => {
    const next: GameLinuxConfig = {}
    setConfig(next)
    await save(next)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/[.07] bg-slate-950/98 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[.07] bg-white/5">
          <Terminal className="h-5 w-5 text-white shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">Linux / VR Config</div>
            {gameName && <div className="text-xs text-zinc-400 truncate">{gameName}</div>}
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="text-sm text-zinc-400 py-4 text-center">Loading…</div>
          ) : (
            <>
              {/* Launch Mode */}
              <div className="space-y-2 rounded-lg border border-white/[.07] bg-zinc-900/40 p-3">
                <div>
                  <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Quick Presets</label>
                  <p className="text-[11px] text-zinc-400 mt-1">Apply a launch setup, then fine-tune individual overrides below.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {LINUX_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => { void applyPreset(preset.id) }}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-white/10"
                      title={preset.description}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Launch Mode</label>
                <Select
                  value={config.launchMode || 'inherit'}
                  onValueChange={(v) => update({ launchMode: v as LinuxPerGameLaunchMode })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Inherit from global settings</SelectItem>
                    <SelectItem value="auto">Auto (native or Wine)</SelectItem>
                    <SelectItem value="native">Native only</SelectItem>
                    <SelectItem value="wine">Wine</SelectItem>
                    <SelectItem value="proton">Proton (Steam)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Wine Binary */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Wine Binary <span className="normal-case text-zinc-400/60">(overrides global)</span></label>
                <div className="flex gap-2">
                  <Input
                    value={config.winePath || ''}
                    onChange={(e) => setConfig({ ...config, winePath: e.target.value })}
                    onBlur={() => save(config)}
                    placeholder="Inherit from global"
                    className="flex-1 h-9 text-sm"
                  />
                  <Button variant="outline" size="sm" className="h-9" onClick={handlePickWineBinary}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Proton Script */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Proton Script <span className="normal-case text-zinc-400/60">(overrides global)</span></label>
                <div className="flex gap-2">
                  <Input
                    value={config.protonPath || ''}
                    onChange={(e) => setConfig({ ...config, protonPath: e.target.value })}
                    onBlur={() => save(config)}
                    placeholder="Inherit from global"
                    className="flex-1 h-9 text-sm"
                  />
                  <Button variant="outline" size="sm" className="h-9" onClick={handlePickProtonBinary}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* WINEPREFIX */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">WINEPREFIX <span className="normal-case text-zinc-400/60">(overrides global)</span></label>
                <div className="flex gap-2">
                  <Input
                    value={config.winePrefix || ''}
                    onChange={(e) => setConfig({ ...config, winePrefix: e.target.value })}
                    onBlur={() => save(config)}
                    placeholder="Inherit from global"
                    className="flex-1 h-9 text-sm"
                  />
                  <Button variant="outline" size="sm" className="h-9" onClick={handlePickWinePrefix}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Proton Prefix */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Proton Prefix <span className="normal-case text-zinc-400/60">(STEAM_COMPAT_DATA_PATH)</span></label>
                <div className="flex gap-2">
                  <Input
                    value={config.protonPrefix || ''}
                    onChange={(e) => setConfig({ ...config, protonPrefix: e.target.value })}
                    onBlur={() => save(config)}
                    placeholder={`Auto: ~/.local/share/uc-proton/${appid || 'APPID'}`}
                    className="flex-1 h-9 text-sm"
                  />
                  <Button variant="outline" size="sm" className="h-9" onClick={handlePickProtonPrefix}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[10px] text-zinc-400/60">
                  Leave empty to use automatic per-game prefix (~/.local/share/uc-proton/{appid})
                </p>
              </div>

              {/* VR Override */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">VR Support</label>
                <Select
                  value={config.vrEnabled === true ? 'on' : config.vrEnabled === false ? 'off' : 'inherit'}
                  onValueChange={(v) => update({ vrEnabled: v === 'on' ? true : v === 'off' ? false : undefined })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Inherit from global settings</SelectItem>
                    <SelectItem value="on">Force on for this game</SelectItem>
                    <SelectItem value="off">Force off for this game</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* XR Runtime JSON override */}
              {config.vrEnabled !== false && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">XR_RUNTIME_JSON <span className="normal-case text-zinc-400/60">(overrides global)</span></label>
                  <Input
                    value={config.vrXrRuntimeJson || ''}
                    onChange={(e) => setConfig({ ...config, vrXrRuntimeJson: e.target.value })}
                    onBlur={() => save(config)}
                    placeholder="Inherit from global"
                    className="h-9 text-sm"
                  />
                </div>
              )}

              {/* Extra env vars */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-zinc-400" />
                  <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Extra env vars <span className="normal-case text-zinc-400/60">(appended to global)</span></label>
                </div>
                <textarea
                  value={config.extraEnv || ''}
                  onChange={(e) => setConfig({ ...config, extraEnv: e.target.value })}
                  onBlur={() => save(config)}
                  rows={3}
                  placeholder={"DXVK_HUD=fps\nWINEDEBUG=-all"}
                  className="w-full rounded-md border border-input bg-[#09090b] px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                />
              </div>

              {/* SLSteam section */}
              <div className="rounded-lg border border-white/[.07] bg-zinc-900/30 p-3 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <FlaskConical className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-xs font-medium">SLSteam</span>
                  {slsSteamGlobal !== null && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${slsSteamGlobal.found ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-zinc-800/30 text-zinc-400 border-white/[.07]'}`}>
                      {slsSteamGlobal.found ? 'installed' : 'not installed'}
                    </span>
                  )}
                  {slsSteamStatus?.found && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      steam_appid.txt: {slsSteamStatus.steamAppId || '0'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400">
                  SLSteam enables Steam overlay and features for non-Steam games. Requires SLSteam to be installed and enabled in global settings.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <Input
                      value={config.slsSteamAppId || ''}
                      onChange={(e) => setConfig({ ...config, slsSteamAppId: e.target.value })}
                      onBlur={() => save(config)}
                      placeholder="Steam App ID (0 for generic)"
                      className="h-8 text-xs"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs shrink-0"
                    onClick={handleSetupSls}
                    disabled={settingUpSls}
                  >
                    {settingUpSls ? 'Writing…' : 'Write steam_appid.txt'}
                  </Button>
                </div>
              </div>

              {/* Feedback */}
              {feedback && (
                <div className={`text-xs rounded-md px-3 py-2 ${feedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-destructive/10 text-destructive border border-destructive/30'}`}>
                  {feedback.message}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/[.07] bg-white/5">
          <Button variant="ghost" size="sm" className="text-xs text-zinc-400" onClick={handleReset} disabled={saving}>
            Reset to global defaults
          </Button>
          <div className="flex gap-2">
            {saving && <span className="text-xs text-zinc-400 self-center">Saving…</span>}
            <Button size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

