import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") {
  process.exit(0);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolsDir = path.join(projectRoot, "src-tauri", "target", ".tauri");
const launcher = `#!/bin/sh
set -eu

self_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
appdir=\${APPDIR:-$self_dir}
export APPDIR=\"$appdir\"
appusr=\"$appdir/usr\"

# Ubuntu's bundled WebKitGTK can fail EGL initialization on Fedora and other
# distributions. Prefer the system WebKitGTK stack when it is installed;
# retain the bundled stack as a fallback for hosts without it.
host_libs=\"/usr/lib64:/usr/lib/x86_64-linux-gnu:/usr/lib/aarch64-linux-gnu:/usr/lib\"
host_webkit=
for dir in /usr/lib64 /usr/lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /usr/lib; do
  if [ -f \"$dir/libwebkit2gtk-4.1.so.0\" ]; then
    host_webkit=1
    break
  fi
done
if [ -n "$host_webkit" ]; then
  for dir in /usr/libexec/webkit2gtk-4.1 /usr/lib64/webkit2gtk-4.1 /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 /usr/lib/aarch64-linux-gnu/webkit2gtk-4.1 /usr/lib/webkit2gtk-4.1; do
    if [ -x "$dir/WebKitWebProcess" ] && [ -x "$dir/WebKitNetworkProcess" ]; then
      export WEBKIT_EXEC_PATH="$dir"
      break
    fi
  done
fi

app_libs=\"$appusr/lib:$appusr/lib/x86_64-linux-gnu:$appusr/lib/aarch64-linux-gnu\"
if [ -n \"$host_webkit\" ]; then
  export LD_LIBRARY_PATH=\"$host_libs:$app_libs:\${LD_LIBRARY_PATH:-}\"
else
  export LD_LIBRARY_PATH=\"$app_libs:$host_libs:\${LD_LIBRARY_PATH:-}\"
fi

cd \"$appusr\"
exec \"$appusr/bin/union-manifold\" \"$@\"
`;

await mkdir(toolsDir, { recursive: true });
for (const arch of ["x86_64", "aarch64", "i686", "armv7"]) {
  const target = path.join(toolsDir, `AppRun-${arch}`);
  await writeFile(target, launcher, "utf8");
  await chmod(target, 0o755);
}
