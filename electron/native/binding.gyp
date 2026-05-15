{
  "targets": [
    {
      "target_name": "uc_overlay_native",
      "sources": [
        "addon.cpp",
        "volume_control.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        {
          "conditions": [ "OS=='win'" ],
          "sources": [
            "injector.cpp",
            "shared_memory.cpp",
            "pipe_server.cpp",
            "gcpad_bridge.cpp"
          ],
          "libraries": [
            "-luser32",
            "-lkernel32",
            "-ladvapi32",
            "-lole32"
          ]
        },
        {
          "conditions": [ "OS=='linux'" ],
          "sources": [
            "gcpad_bridge_posix.cpp"
          ],
          "libraries": [
            "-lX11",
            "-lXtst",
            "-ldl",
            "-lpthread"
          ]
        },
        {
          "conditions": [ "OS=='mac'" ],
          "sources": [
            "stubs_nonwin.cpp"
          ]
        }
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "RuntimeLibrary": 2
        }
      }
    }
  ]
}