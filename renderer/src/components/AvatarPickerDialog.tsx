import { useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ProfileMediaCropDialog } from "@/components/ProfileMediaCropDialog"
import { proxyImageUrl } from "@/lib/utils"
import { CheckCircle2, Upload } from "lucide-react"
import { Loader2 } from "@/components/icons"
import type { ProfileImages, ProfileMediaKind } from "@/hooks/use-profile-images"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: ProfileMediaKind
  images: ProfileImages
  currentUrl: string | null
  busy?: boolean
  cooldownActive?: boolean
  nextChangeAt?: string | null
  onUpload: (file: File) => void | Promise<void>
  onSelectRecent: (fileId: number) => void | Promise<void>
  onSelectOAuth?: (source: string) => void | Promise<void>
}

export function AvatarPickerDialog({
  open,
  onOpenChange,
  kind,
  images,
  currentUrl,
  busy = false,
  cooldownActive = false,
  nextChangeAt = null,
  onUpload,
  onSelectRecent,
  onSelectOAuth,
}: Props) {
  const isAvatar = kind === "avatar"
  const recents = isAvatar ? images.recentAvatars : images.recentBanners
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)

  const round = isAvatar ? "rounded-2xl" : "rounded-xl"
  const previewBox = isAvatar ? "h-24 w-24" : "h-20 w-full max-w-[280px]"
  const thumbBox = isAvatar ? "aspect-square" : "aspect-[3/1]"

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setCropFile(file)
      setCropOpen(true)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Change {isAvatar ? "avatar" : "banner"}</DialogTitle>
            <DialogDescription>
              Upload a new image, pick a recent one{isAvatar ? ", or use your connected account avatar" : ""}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Current + upload */}
            <div className="flex items-center gap-4">
              <div className={`${previewBox} ${round} shrink-0 overflow-hidden border border-white/10 bg-secondary/60`}>
                {currentUrl ? (
                  <img src={proxyImageUrl(currentUrl)} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || cooldownActive}
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload new
                </Button>
                {cooldownActive && nextChangeAt && (
                  <p className="text-[11px] text-muted-foreground">
                    Next upload available {new Date(nextChangeAt).toLocaleDateString()}. Picking a recent one is always free.
                  </p>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onPick} />
              </div>
            </div>

            {/* Recent uploads */}
            {recents.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Recent uploads</p>
                <div className={`grid gap-2 ${isAvatar ? "grid-cols-5" : "grid-cols-2"}`}>
                  {recents.map((item) => (
                    <button
                      key={item.fileId}
                      type="button"
                      disabled={busy}
                      onClick={() => void onSelectRecent(item.fileId)}
                      className={`group relative ${thumbBox} overflow-hidden ${round} border transition-all disabled:opacity-50 ${
                        item.isCurrent ? "border-primary ring-2 ring-primary/40" : "border-white/10 hover:border-white/30"
                      }`}
                      title={item.isCurrent ? "Current" : "Use this"}
                    >
                      <img src={proxyImageUrl(item.url)} alt="" className="h-full w-full object-cover" />
                      {item.isCurrent && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* OAuth account avatars (avatar only) */}
            {isAvatar && onSelectOAuth && images.oauthAvatars.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Use account avatar</p>
                <div className="flex flex-wrap gap-2">
                  {images.oauthAvatars.map((oauth) => {
                    const active = images.avatarSource === oauth.source
                    return (
                      <button
                        key={oauth.source}
                        type="button"
                        disabled={busy}
                        onClick={() => void onSelectOAuth(oauth.source)}
                        className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-all disabled:opacity-50 ${
                          active ? "border-primary ring-2 ring-primary/40" : "border-white/10 hover:border-white/30"
                        }`}
                      >
                        <span className="h-7 w-7 overflow-hidden rounded-full bg-secondary/60">
                          <img src={proxyImageUrl(oauth.url)} alt="" className="h-full w-full object-cover" />
                        </span>
                        {oauth.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProfileMediaCropDialog
        open={cropOpen}
        kind={kind}
        file={cropFile}
        onOpenChange={(o) => { setCropOpen(o); if (!o) setCropFile(null) }}
        onApply={(file) => { void onUpload(file) }}
      />
    </>
  )
}
